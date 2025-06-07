import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const VerifyEmail = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-cyan-500">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
        <h2 className="text-2xl font-bold mb-4">Verify your email</h2>
        <p className="mb-6">
          We've sent a verification link to your email address. Please check your inbox and click the link to activate your account.
        </p>
        <Button onClick={() => navigate("/auth")}>Back to Login</Button>
      </div>
    </div>
  );
};

export default VerifyEmail; 