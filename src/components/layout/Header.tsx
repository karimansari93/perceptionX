
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import UserMenu from "@/components/UserMenu";
import AuthModal from "@/components/AuthModal";

const Header = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);

  return (
    <>
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <img alt="Perception Logo" className="h-5 object-fill" src="/lovable-uploads/f1e89523-319d-4c42-bf67-03c76342a128.png" />
          </div>
          <div className="flex items-center space-x-3">
            <Button 
              variant="outline" 
              onClick={() => navigate('/demo')}
              className="hidden sm:inline-flex"
            >
              Book Demo
            </Button>
            {user ? (
              <UserMenu />
            ) : (
              <Button 
                onClick={() => setAuthModalOpen(true)} 
                className="bg-primary hover:bg-primary/90"
              >
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>
      
      <AuthModal 
        open={authModalOpen} 
        onOpenChange={setAuthModalOpen}
      />
    </>
  );
};

export default Header;
