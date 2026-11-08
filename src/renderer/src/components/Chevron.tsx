// 树节点的展开箭头：SVG chevron，展开时旋转 90°
function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      className={`chevron ${open ? 'open' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export default Chevron
