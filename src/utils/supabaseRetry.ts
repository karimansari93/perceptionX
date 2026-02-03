/**
 * Enhanced Supabase client with retry logic and connection recovery
 */
import { supabase } from "@/integrations/supabase/client";

interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any) => boolean;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
  shouldRetry: (error: any) => {
    // Retry on network errors but not on auth/permission errors
    const errorMessage = error?.message?.toLowerCase() || '';
    const isNetworkError = errorMessage.includes('network') ||
                          errorMessage.includes('connection') ||
                          errorMessage.includes('timeout') ||
                          errorMessage.includes('fetch') ||
                          errorMessage.includes('failed to send a request') ||
                          errorMessage.includes('edge function') ||
                          errorMessage.includes('load') ||
                          errorMessage.includes('err_failed') ||
                          errorMessage.includes('failed to fetch') ||
                          error?.name === 'NetworkError' ||
                          error?.name === 'FunctionsFetchError' ||
                          error?.name === 'TypeError' ||
                          error?.code === 'ERR_FAILED';
    
    // Don't retry on auth errors or rate limiting
    const isAuthError = errorMessage.includes('auth') ||
                       errorMessage.includes('unauthorized') ||
                       errorMessage.includes('permission') ||
                       errorMessage.includes('forbidden') ||
                       errorMessage.includes('Invalid login credentials') ||
                       errorMessage.includes('Invalid Refresh Token') ||
                       errorMessage.includes('JWT') ||
                       error?.status === 401;
    
    const isRateLimit = errorMessage.includes('rate limit') ||
                       errorMessage.includes('too many requests') ||
                       error?.status === 429;
    
    // Don't retry on URI length errors - these need to be handled differently
    const isUriLengthError = errorMessage.includes('uri too long') ||
                            errorMessage.includes('request entity too large') ||
                            error?.status === 414;
    
    return isNetworkError && !isAuthError && !isRateLimit && !isUriLengthError;
  }
};

/**
 * Sleep utility for delays
 */
const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calculate exponential backoff delay
 */
const calculateDelay = (attempt: number, options: Required<RetryOptions>): number => {
  const delay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt);
  return Math.min(delay, options.maxDelay);
};

/**
 * Enhanced query wrapper with retry logic that awaits the query builder
 */
export async function retrySupabaseQuery<T = any>(
  queryFn: () => any,
  options: RetryOptions = {}
): Promise<{ data: T | null; error: any }> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // console.log(`🔄 Supabase query attempt ${attempt + 1}/${config.maxRetries + 1}`);
      
      const queryBuilder = queryFn();
      // Await the query builder to get the actual result
      const result = await queryBuilder;
      
      // If we have an error but no data, decide whether to retry
      if (result.error && !result.data) {
        lastError = result.error;
        
        if (attempt < config.maxRetries && config.shouldRetry(result.error)) {
          const delay = calculateDelay(attempt, config);
          // console.log(`⏳ Retrying in ${delay}ms due to error:`, result.error.message);
          await sleep(delay);
          continue;
        }
        
        // Don't retry - return the error
        console.error(`❌ Supabase query failed after ${attempt + 1} attempts:`, result.error);
        return result;
      }
      
      // Success case
      if (attempt > 0) {
        // console.log(`✅ Supabase query succeeded on attempt ${attempt + 1}`);
      }
      return result;
      
    } catch (error) {
      lastError = error;
      
      if (attempt < config.maxRetries && config.shouldRetry(error)) {
        const delay = calculateDelay(attempt, config);
        // console.log(`⏳ Retrying in ${delay}ms due to exception:`, error);
        await sleep(delay);
        continue;
      }
      
      // Don't retry - throw the error
      console.error(`❌ Supabase query threw exception after ${attempt + 1} attempts:`, error);
      break;
    }
  }

  // If we get here, all retries failed
  return { data: null, error: lastError };
}

/**
 * Enhanced function invocation with retry logic
 */
export async function retrySupabaseFunction<T>(
  functionName: string,
  body: any,
  options: RetryOptions = {}
): Promise<{ data: T | null; error: any }> {
  return retrySupabaseQuery(
    () => supabase.functions.invoke(functionName, { body }),
    options
  );
}

/**
 * Connection health check
 */
export async function checkSupabaseConnection(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .single();
    
    // Even if we get "no rows" error, the connection is working
    return !error || error.code === 'PGRST116';
  } catch (error) {
    console.error('Supabase connection check failed:', error);
    return false;
  }
}

/**
 * Wait for connection to be restored
 */
export async function waitForConnection(
  maxWaitTime: number = 30000,
  checkInterval: number = 2000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    if (await checkSupabaseConnection()) {
      return true;
    }
    await sleep(checkInterval);
  }
  
  return false;
}

/**
 * Debounced query executor to prevent overwhelming the server
 */
class QueryDebouncer {
  private timeouts = new Map<string, NodeJS.Timeout>();
  
  debounce<T>(
    key: string, 
    queryFn: () => Promise<T>, 
    delay: number = 500
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      // Clear existing timeout for this key
      const existingTimeout = this.timeouts.get(key);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      
      // Set new timeout
      const timeout = setTimeout(async () => {
        try {
          this.timeouts.delete(key);
          const result = await queryFn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, delay);
      
      this.timeouts.set(key, timeout);
    });
  }
  
  clear(key?: string) {
    if (key) {
      const timeout = this.timeouts.get(key);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(key);
      }
    } else {
      // Clear all timeouts
      for (const timeout of this.timeouts.values()) {
        clearTimeout(timeout);
      }
      this.timeouts.clear();
    }
  }
}

export const queryDebouncer = new QueryDebouncer();

/**
 * Network status monitoring
 */
export class NetworkMonitor {
  private isOnline = navigator.onLine;
  private listeners: Array<(isOnline: boolean) => void> = [];
  
  constructor() {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }
  
  private handleOnline = () => {
    this.isOnline = true;
    this.notifyListeners();
  };
  
  private handleOffline = () => {
    this.isOnline = false;
    this.notifyListeners();
  };
  
  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.isOnline));
  }
  
  addListener(listener: (isOnline: boolean) => void) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }
  
  get online() {
    return this.isOnline;
  }
  
  async waitForOnline(timeout: number = 30000): Promise<boolean> {
    if (this.isOnline) return true;
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), timeout);
      
      const removeListener = this.addListener((isOnline) => {
        if (isOnline) {
          clearTimeout(timeoutId);
          removeListener();
          resolve(true);
        }
      });
    });
  }
  
  destroy() {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    this.listeners = [];
  }
}

export const networkMonitor = new NetworkMonitor();
