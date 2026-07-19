/**
 * AiMarkdown — 모든 AI 생성 텍스트의 공용 마크다운 렌더러.
 * 채팅·리포트·일기 답장·세션 코멘트 등 AI 출력은 반드시 이 컴포넌트로 렌더링한다.
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface AiMarkdownProps {
    children: string
    className?: string
}

export default function AiMarkdown({ children, className = '' }: AiMarkdownProps) {
    return (
        <div className={`md-content ${className}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
        </div>
    )
}
