
import { useEffect } from "react";
import Cal, { getCalApi } from "@calcom/embed-react";
import Header from "@/components/layout/Header";

const Demo = () => {
  useEffect(() => {
    (async function () {
      const cal = await getCalApi({"namespace":"30min"});
      cal("ui", {"hideEventTypeDetails":false,"layout":"month_view"});
    })();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <div className="container mx-auto px-6 py-12">
        <div className="max-w-4xl mx-auto">
          {/* Simple Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Book a demo
            </h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Schedule a personalized demo to see how our AI perception tracking can help your employer brand.
            </p>
          </div>

          {/* Cal.com Embed */}
          <div className="bg-white rounded-lg shadow-sm border">
            <Cal 
              namespace="30min"
              calLink="karimalansari/30min"
              style={{width:"100%",height:"600px",overflow:"scroll"}}
              config={{"layout":"month_view"}}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Demo;
