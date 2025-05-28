
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Users, Target } from "lucide-react";

const UseCasesSection = () => {
  return (
    <section className="bg-gray-50 py-16">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Track your recruitment goals
          </h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="flex items-center">
                <TrendingUp className="w-5 h-5 text-green-600 mr-2" />
                Tech Hiring in Traditional Industries
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Track how AI models perceive your tech roles in oil & gas, manufacturing, or finance. 
                Get insights to improve your positioning for tech talent.
              </p>
            </CardContent>
          </Card>
          
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Users className="w-5 h-5 text-primary mr-2" />
                Diversity & Inclusion Tracking
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Monitor how AI models represent your company's commitment to diversity 
                and inclusion in responses about career opportunities.
              </p>
            </CardContent>
          </Card>
          
          <Card className="bg-white">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Target className="w-5 h-5 text-purple-600 mr-2" />
                Competitive Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Compare how your employer brand is perceived relative to competitors 
                across different AI models and use cases.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
};

export default UseCasesSection;
