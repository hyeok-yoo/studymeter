/**
 * BrandMark — 평면 마크: 눈금 다섯 개와 앰버 바늘 하나.
 * 글자색(currentColor)을 따르고, 바늘만 --lamp 를 쓴다.
 */
export default function BrandMark({ className = '' }: { className?: string }) {
    return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
            <rect x="2" y="12" width="1.5" height="5" rx="0.75" fill="currentColor" opacity="0.45" />
            <rect x="6" y="9" width="1.5" height="8" rx="0.75" fill="currentColor" opacity="0.7" />
            <rect x="10" y="5" width="1.5" height="12" rx="0.75" fill="currentColor" />
            <rect x="14" y="2" width="2" height="15" rx="1" fill="var(--lamp)" />
        </svg>
    )
}
