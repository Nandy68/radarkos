export function PlaceholderImage({
  propertyType,
}: {
  propertyType?: string | null;
}) {
  return (
    <div className="relative w-full h-full min-h-[190px] bg-gradient-to-br from-[#f2f3ff] via-[#eaedff] to-[#f2f3ff] flex flex-col items-center justify-center p-6 text-[#6d7a72] overflow-hidden select-none border-b border-[#bccac0]/30">
      {/* Background subtle architectural blueprint grid pattern */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #bccac0 1px, transparent 0)`,
          backgroundSize: "16px 16px",
        }}
      />

      {/* Modern architectural floor-plan room illustration */}
      <svg
        className="w-14 h-14 text-[#6d7a72] stroke-[1.4] mb-2 relative z-10 transition-transform duration-300 group-hover:scale-105"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Room boundary */}
        <rect x="10" y="10" width="44" height="44" rx="6" className="stroke-[#bccac0] fill-white/80" />
        {/* Door arc */}
        <path d="M10 42 A 12 12 0 0 1 22 54" strokeDasharray="2 2" className="stroke-[#6d7a72]" />
        <line x1="10" y1="54" x2="10" y2="42" className="stroke-[#6d7a72]" />
        {/* Bed */}
        <rect x="32" y="14" width="18" height="24" rx="3" className="stroke-[#6d7a72] fill-[#f2f3ff]" />
        <line x1="32" y1="20" x2="50" y2="20" className="stroke-[#bccac0]" />
        {/* Desk / Study table */}
        <rect x="14" y="14" width="12" height="18" rx="2" className="stroke-[#6d7a72] fill-[#f2f3ff]" />
        {/* Window with emerald glow */}
        <line x1="22" y1="10" x2="32" y2="10" className="stroke-[#006948] stroke-2" />
      </svg>

      <span className="text-[10px] font-bold tracking-wider uppercase text-[#3d4a42] relative z-10 text-center">
        {propertyType ? propertyType.replace("_", " ") : "PROPERTI"} • FOTO DI SUMBER ASLI
      </span>
    </div>
  );
}
