import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TrendingUp, Bot, Headphones, ChevronLeft, ChevronRight } from 'lucide-react';

interface WelcomeProModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const WelcomeProModal = ({ open, onOpenChange }: WelcomeProModalProps) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  const slides = [
    {
      icon: TrendingUp,
      title: "Weekly Updates",
      description: "You'll be notified about new insights and changes in your AI perception every week."
    },
    {
      icon: Bot,
      title: "Access to All AI Models",
      description: "Get comprehensive insights from all major AI platforms including the latest models."
    },
    {
      icon: Headphones,
      title: "Customer Support",
      description: "Get priority support from our team. Book direct calls, get personalized recommendations, and receive dedicated assistance for your perception strategy."
    }
  ];

  const handleGetStarted = () => {
    onOpenChange(false);
  };

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  };

  const goToSlide = (index: number) => {
    setCurrentSlide(index);
  };

  // Touch handlers for swipe functionality
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (!touchStartX.current || !touchEndX.current) return;
    
    const distance = touchStartX.current - touchEndX.current;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    if (isLeftSwipe && currentSlide < slides.length - 1) {
      nextSlide();
    }
    if (isRightSwipe && currentSlide > 0) {
      prevSlide();
    }

    // Reset touch positions
    touchStartX.current = null;
    touchEndX.current = null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[500px] p-4 sm:p-6">
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            <div className="flex items-center gap-3">
              <img
                src="/logos/PerceptionX-PrimaryLogo.png"
                alt="PerceptionX Logo"
                className="h-8"
              />
              <div className="bg-[#0DBCBA] text-white px-3 py-1 rounded-full text-sm font-bold">
                PRO
              </div>
            </div>
          </div>
          <p className="text-center text-[#183056] text-base sm:text-lg">
            You now have access to all premium features
          </p>
        </DialogHeader>

        <div className="space-y-4 sm:space-y-6 py-4">
          {/* Carousel Container */}
          <div className="relative">
            {/* Navigation Arrows - Hidden on mobile */}
            <Button
              variant="ghost"
              size="icon"
              onClick={prevSlide}
              className="absolute left-2 top-1/2 transform -translate-y-1/2 z-10 h-8 w-8 rounded-full bg-white/80 hover:bg-white shadow-md hidden sm:flex"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={nextSlide}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 z-10 h-8 w-8 rounded-full bg-white/80 hover:bg-white shadow-md hidden sm:flex"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>

            {/* Slide Content */}
            <div 
              className="bg-[#EBECED] rounded-lg p-4 sm:p-6 text-center min-h-[200px] flex flex-col justify-center touch-pan-y"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <div className="flex justify-center mb-4">
                <div className="bg-white rounded-full p-3">
                  {React.createElement(slides[currentSlide].icon, {
                    className: "w-8 h-8 text-[#0DBCBA]"
                  })}
                </div>
              </div>
              <h3 className="font-semibold text-[#13274F] text-lg mb-3">
                {slides[currentSlide].title}
              </h3>
              <p className="text-[#183056] leading-relaxed">
                {slides[currentSlide].description}
              </p>
            </div>

            {/* Dots Indicator */}
            <div className="flex justify-center gap-2 mt-4">
              {slides.map((_, index) => (
                <button
                  key={index}
                  onClick={() => goToSlide(index)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    index === currentSlide ? 'bg-[#0DBCBA]' : 'bg-gray-300'
                  }`}
                  aria-label={`Go to slide ${index + 1}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="flex flex-col sm:flex-row justify-center gap-3 pt-4">
          <Button 
            onClick={handleGetStarted}
            variant="default"
            className="w-full sm:w-auto"
          >
            I'm ready
          </Button>
          <Button 
            variant="outline"
            onClick={() => window.open('https://meetings-eu1.hubspot.com/karim-al-ansari', '_blank')}
            className="w-full sm:w-auto"
          >
            Got any questions?
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}; 