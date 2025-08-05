// Security configuration for the application
export const securityConfig = {
  // Rate limiting settings
  rateLimit: {
    maxRequests: 100,
    windowMs: 15 * 60 * 1000, // 15 minutes
  },
  
  // Input validation settings
  validation: {
    maxEmailLength: 254,
    maxPasswordLength: 128,
    minPasswordLength: 8,
    maxCompanyNameLength: 100,
    maxIndustryLength: 50,
  },
  
  // Content Security Policy settings
  csp: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      "https://cdn.gpteng.co",
      "https://client.crisp.chat",
      "https://www.google.com",
      "https://www.gstatic.com"
    ],
    styleSrc: [
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
      "https://client.crisp.chat"
    ],
    fontSrc: [
      "'self'",
      "https://fonts.gstatic.com",
      "https://client.crisp.chat"
    ],
    imgSrc: [
      "'self'",
      "data:",
      "https:"
    ],
    connectSrc: [
      "'self'",
      "https://ofyjvfmcgtntwamkubui.supabase.co",
      "wss://ofyjvfmcgtntwamkubui.supabase.co",
      "https://api.stripe.com",
      "https://client.crisp.chat",
      "wss://client.relay.crisp.chat"
    ],
    frameSrc: [
      "'self'",
      "https://js.stripe.com"
    ],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"]
  },
  
  // Allowed domains for external resources
  allowedDomains: [
    'ofyjvfmcgtntwamkubui.supabase.co',
    'api.stripe.com',
    'client.crisp.chat',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.gpteng.co',
    'www.google.com',
    'www.gstatic.com'
  ],
  
  // Sensitive data patterns to avoid logging
  sensitivePatterns: [
    /password/i,
    /token/i,
    /key/i,
    /secret/i,
    /api[_-]?key/i,
    /private[_-]?key/i
  ]
};

// Security utility functions
export const securityUtils = {
  // Check if a string contains sensitive data
  containsSensitiveData: (text: string): boolean => {
    return securityConfig.sensitivePatterns.some(pattern => pattern.test(text));
  },
  
  // Sanitize data for logging (remove sensitive information)
  sanitizeForLogging: (data: any): any => {
    if (typeof data === 'string') {
      if (securityUtils.containsSensitiveData(data)) {
        return '[REDACTED]';
      }
      return data;
    }
    
    if (typeof data === 'object' && data !== null) {
      const sanitized: any = Array.isArray(data) ? [] : {};
      for (const [key, value] of Object.entries(data)) {
        if (securityUtils.containsSensitiveData(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = securityUtils.sanitizeForLogging(value);
        }
      }
      return sanitized;
    }
    
    return data;
  },
  
  // Validate email format
  isValidEmail: (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= securityConfig.validation.maxEmailLength;
  },
  
  // Validate password strength
  isValidPassword: (password: string): boolean => {
    return password.length >= securityConfig.validation.minPasswordLength &&
           password.length <= securityConfig.validation.maxPasswordLength;
  },
  
  // Validate company name
  isValidCompanyName: (name: string): boolean => {
    return name.length > 0 && name.length <= securityConfig.validation.maxCompanyNameLength;
  },
  
  // Validate industry
  isValidIndustry: (industry: string): boolean => {
    return industry.length > 0 && industry.length <= securityConfig.validation.maxIndustryLength;
  }
}; 