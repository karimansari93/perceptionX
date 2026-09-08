import { Favicon } from '@/components/ui/favicon';

// The looping "Ask AI answering" demo inside the what's-new header band:
// a typed question, then the answer line, the sentiment bar and two
// citation pills rise in on a 9 s CSS loop (keyframes in index.css, `px-demo-*`).
// prefers-reduced-motion shows the end state, no loop.
export function AskAiDemo() {
  return (
    <div className="px-demo absolute left-5 right-5 top-6 flex flex-col gap-[9px] rounded-xl border border-[#13274F]/10 bg-white px-[14px] py-3 shadow-[0_6px_20px_rgba(19,39,79,.08)]">
      {/* User bubble, typed */}
      <div className="flex justify-end">
        <div className="flex items-center rounded-[10px] bg-[#f4f4f5] px-2.5 py-1.5 text-[11.5px] text-[#13274F]">
          <span className="px-demo-type block overflow-hidden whitespace-nowrap">Why did sentiment drop 13 points?</span>
          <span className="px-demo-caret ml-0.5 inline-block h-3 w-[1.5px] bg-[#13274F]" />
        </div>
      </div>

      {/* Assistant */}
      <div className="flex items-start gap-2">
        <img alt="" src="/logos/PinkBadge.png" className="mt-px h-[17px] w-[17px] flex-none object-contain" />
        <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
          <p className="px-demo-s1 text-[11.5px] leading-[1.45] text-[#13274F]">
            Reddit threads on the July restructuring drove 6 of the 13 points.
          </p>
          <div className="px-demo-s2 flex items-center gap-2">
            <span className="w-16 flex-none text-[10.5px] text-gray-500">Sentiment</span>
            <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-[#eef0f3]">
              <div className="px-demo-bar h-full rounded-full bg-[#22c55e]" />
            </div>
            <span className="text-[10.5px] font-semibold tabular-nums text-[#13274F]">69%</span>
            <span className="text-[10.5px] font-semibold tabular-nums text-[#dc2626]">▼13</span>
          </div>
          <div className="px-demo-s3 flex gap-1.5">
            {[['reddit.com', 14], ['glassdoor.com', 9]].map(([domain, n]) => (
              <span key={String(domain)} className="inline-flex items-center gap-1 rounded-md border border-[#13274F]/10 bg-white px-1.5 py-0.5 text-[10px] text-gray-500">
                <Favicon domain={String(domain)} size="sm" className="!h-2.5 !w-2.5 rounded-sm" />
                {domain} · {n}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
