interface SkeletonProps {
  height?: number | string
  width?: number | string
  borderRadius?: number
  style?: React.CSSProperties
}

export default function Skeleton({ height = 20, width = '100%', borderRadius = 4, style }: SkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{ height, width, borderRadius, ...style }}
    />
  )
}
