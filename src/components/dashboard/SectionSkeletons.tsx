import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const OverviewSkeleton = () => {
  return (
    <div className="space-y-8">
      {/* Metrics Cards - Match MetricCard component heights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="h-full min-h-[140px]">
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-10 w-24 mb-2" />
              <Skeleton className="h-4 w-48" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Cards Grid - Match OverviewTab card heights (min-h-[240px]) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* EPS Card Skeleton */}
        <Card className="min-h-[240px] flex flex-col">
          <div className="px-8 pt-6 pb-1 flex-shrink-0">
            <Skeleton className="h-6 w-32 mb-4" />
            <Skeleton className="h-16 w-32 mb-2" />
          </div>
          <div className="flex-1 flex items-end px-8 pb-4">
            <Skeleton className="h-[60px] w-full" />
          </div>
        </Card>

        {/* Breakdown Card Skeleton */}
        <Card className="min-h-[240px] flex flex-col">
          <CardHeader className="pb-2 pt-6 px-4 sm:px-8 flex-shrink-0">
            <Skeleton className="h-6 w-32 mb-4" />
          </CardHeader>
          <CardContent className="px-4 sm:px-8 pb-4 flex-1 flex flex-col justify-center">
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-2 w-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Citations Card - Match SourcesSummaryCard */}
      <Card className="min-h-[200px]">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="flex items-center space-x-2 flex-1 min-w-0">
                  <Skeleton className="h-5 w-5 rounded flex-shrink-0" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-4 w-8" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top Competitors Card - Match CompetitorsSummaryCard */}
      <Card className="min-h-[200px]">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="flex items-center space-x-2 flex-1 min-w-0">
                  <Skeleton className="h-5 w-5 rounded flex-shrink-0" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-4 w-8" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const PromptsSkeleton = () => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>

      {/* Prompts Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-48" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-0 border rounded-lg">
            {/* Table Header */}
            <div className="grid grid-cols-6 gap-4 p-4 border-b bg-gray-50">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
            </div>
            {/* Table Rows */}
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="grid grid-cols-6 gap-4 p-4 border-b last:border-b-0">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const ResponsesSkeleton = () => {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* Filter (if Pro) */}
      <Skeleton className="h-10 w-48" />

      {/* Responses Table */}
      <Card>
        <CardContent className="p-0">
          <div className="space-y-0 border rounded-lg overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-5 gap-4 p-4 border-b bg-gray-50">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
            {/* Table Rows - Match actual response row height */}
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="grid grid-cols-5 gap-4 p-4 border-b last:border-b-0 hover:bg-gray-50/50">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const AnswerGapsSkeleton = () => {
  return (
    <div className="space-y-6">
      {/* Content Score Card - Match actual card structure */}
      <Card className="min-h-[200px]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-6 w-24" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </CardContent>
      </Card>

      {/* Actionable Tasks/Gaps List */}
      <Card className="min-h-[400px]">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border rounded-lg p-4 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <div className="flex gap-2 mt-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-6 w-24" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const ReportsSkeleton = () => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-96" />
      </div>

      {/* Report Options Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="min-h-[200px]">
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-3/4 mb-4" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}; 