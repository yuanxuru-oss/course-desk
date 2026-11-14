/**
 * 2D 小兔 —— 3D 版本还没加载完(或这台设备不支持 WebGL)时先顶上去。
 *
 * 造型语言:白身子、粗黑描边、点点眼、×嘴、橘色小裙子。
 * 米菲是 Mercis bv 的注册角色,这里是同一套风格的原创形象。
 */
export function Bunny({ sleepy, size = 120 }: { sleepy?: boolean; size?: number }) {
  const ink = '#241F1A'
  const white = '#FFFDF7'
  return (
    <svg
      viewBox="0 0 220 268"
      width={size}
      height={size * 1.22}
      className="overflow-visible"
      aria-label="课程桌小兔"
    >
      <ellipse cx="110" cy="252" rx="44" ry="7" fill={ink} opacity="0.10" />
      <g className="animate-pet-float">
        <g stroke={ink} strokeWidth="5" fill={white} strokeLinejoin="round">
          <ellipse cx="86" cy="56" rx="15" ry="40" transform="rotate(-10 86 56)" />
          <ellipse cx="134" cy="56" rx="15" ry="40" transform="rotate(10 134 56)" />
        </g>
        <circle cx="110" cy="128" r="52" fill={white} stroke={ink} strokeWidth="5" />
        {sleepy ? (
          <g stroke={ink} strokeWidth="4.5" strokeLinecap="round" fill="none">
            <path d="M86 124 q8 7 16 0" />
            <path d="M118 124 q8 7 16 0" />
          </g>
        ) : (
          <g fill={ink} className="pet-blink">
            <circle cx="94" cy="122" r="6" />
            <circle cx="126" cy="122" r="6" />
          </g>
        )}
        <g stroke={ink} strokeWidth="4.5" strokeLinecap="round">
          <path d="M104 148 l12 11" />
          <path d="M116 148 l-12 11" />
        </g>
        <path d="M82 176 h56 l10 58 q-38 10 -76 0 z" fill="#E5763A" stroke={ink} strokeWidth="5" strokeLinejoin="round" />
        <path d="M100 206 h20 l-3 14 q-7 3 -14 0 z" fill="#D2622B" stroke={ink} strokeWidth="3.5" strokeLinejoin="round" />
        <g stroke={ink} strokeWidth="5" fill={white} strokeLinecap="round">
          <ellipse cx="66" cy="196" rx="11" ry="16" transform="rotate(-14 66 196)" />
          <ellipse cx="154" cy="196" rx="11" ry="16" transform="rotate(14 154 196)" />
        </g>
        <g stroke={ink} strokeWidth="4.5" fill={white}>
          <ellipse cx="94" cy="238" rx="12" ry="9" />
          <ellipse cx="126" cy="238" rx="12" ry="9" />
        </g>
      </g>
    </svg>
  )
}
