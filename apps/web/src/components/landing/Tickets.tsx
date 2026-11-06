// Three glass claim tickets rising out of the clouds: a folder, a locked file, a document.
// They are pictures, not data, so they carry no names, sizes or addresses.

import type { ReactNode } from "react";
import { FrontClouds } from "./Sky";
import { Doc, Folder, Lock } from "./icons";

function Bars({ widths }: { widths: string[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {widths.map((w, i) => (
        <span key={i} className="h-3 rounded-full bg-white/70 shadow-[inset_0_1px_0_#fff]" style={{ width: w }} />
      ))}
    </div>
  );
}

function ClaimTicket({
  icon,
  bars,
  tilt,
  delay,
  className,
  big,
}: {
  icon: ReactNode;
  bars: string[];
  tilt: string;
  delay: string;
  className?: string;
  big?: boolean;
}) {
  return (
    <div className={className}>
      <div className="ticket-float" style={{ ["--tilt" as string]: tilt, ["--delay" as string]: delay }}>
      <div className={`glass claim flex flex-col rounded-[22px] ${big ? "h-[260px] w-[220px] sm:h-[300px] sm:w-[250px]" : "h-[210px] w-[176px] sm:h-[250px] sm:w-[206px]"}`}>
        <div className={`flex flex-1 flex-col justify-between ${big ? "p-6" : "p-5"}`}>
          <div className={`glass-soft flex items-center justify-center rounded-2xl text-[#3a6fd8] ${big ? "size-[68px]" : "size-14"}`}>
            {icon}
          </div>
          <Bars widths={bars} />
        </div>
        <div className="perforation mx-4" />
        <div className={`flex items-center justify-between px-5 ${big ? "h-[30%]" : "h-[28%]"}`}>
          <span className="h-2.5 w-16 rounded-full bg-white/60" />
          <span className="flex size-7 items-center justify-center rounded-full border border-white/80 bg-white/40">
            <span className="size-2 rounded-full bg-[#9c2b21]/80" />
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}

export function TicketStack() {
  return (
    <div aria-hidden className="relative mx-auto flex h-[330px] max-w-[760px] items-end justify-center sm:h-[370px]">
      <ClaimTicket
        icon={<Folder width={30} height={30} />}
        bars={["78%", "56%", "64%"]}
        tilt="-9deg"
        delay="120ms"
        className="absolute bottom-6 left-1/2 -translate-x-[150%] max-sm:-translate-x-[135%] max-sm:scale-[0.7] max-sm:origin-bottom-right"
      />
      <ClaimTicket
        icon={<Doc width={30} height={30} />}
        bars={["70%", "84%", "48%"]}
        tilt="8deg"
        delay="240ms"
        className="absolute bottom-6 left-1/2 translate-x-[50%] max-sm:translate-x-[35%] max-sm:scale-[0.7] max-sm:origin-bottom-left"
      />
      <ClaimTicket icon={<Lock width={36} height={36} />} bars={["86%", "62%", "72%"]} tilt="-1.5deg" delay="0ms" big className="relative z-10 mb-14 max-sm:mb-10 max-sm:origin-bottom max-sm:scale-[0.84]" />
      <FrontClouds />
    </div>
  );
}
