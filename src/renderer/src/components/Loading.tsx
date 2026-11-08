import { useSettings } from '../state/settings'

// 煤球精灵 loading：一颗会蹦的小煤球，app 的吉祥物
function Loading({ text }: { text?: string }): React.JSX.Element {
  const { t } = useSettings()
  const label = text ?? t.common.loading
  return (
    <div className="loading-wrap">
      <svg className="meiqiu-sprite" viewBox="0 0 64 64" width="56" height="56">
        {/* 煤球身体：边缘的小刺是煤灰的毛边 */}
        <g className="sprite-body">
          <circle cx="32" cy="34" r="20" fill="#2b2b2e" />
          {[
            [32, 10, 0],
            [49, 17, 45],
            [54, 34, 90],
            [49, 51, 135],
            [32, 58, 180],
            [15, 51, 225],
            [10, 34, 270],
            [15, 17, 315]
          ].map(([x, y, deg]) => (
            <line
              key={deg}
              x1={32 + (x - 32) * 0.86}
              y1={34 + (y - 34) * 0.86}
              x2={x}
              y2={y}
              stroke="#2b2b2e"
              strokeWidth="3"
              strokeLinecap="round"
            />
          ))}
          {/* 眼睛 */}
          <g className="sprite-eyes">
            <ellipse cx="25" cy="31" rx="4.4" ry="5.4" fill="#fff" />
            <ellipse cx="39" cy="31" rx="4.4" ry="5.4" fill="#fff" />
            <circle cx="26" cy="32.4" r="2" fill="#2b2b2e" />
            <circle cx="40" cy="32.4" r="2" fill="#2b2b2e" />
          </g>
          {/* 腮红 */}
          <circle cx="20.5" cy="39" r="2.6" fill="#7b61ff" opacity="0.45" />
          <circle cx="43.5" cy="39" r="2.6" fill="#7b61ff" opacity="0.45" />
        </g>
        {/* 影子 */}
        <ellipse
          className="sprite-shadow"
          cx="32"
          cy="60"
          rx="12"
          ry="2.4"
          fill="#000"
          opacity="0.12"
        />
      </svg>
      <div className="loading-text">
        {label}
        <span className="loading-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </div>
    </div>
  )
}

export default Loading
