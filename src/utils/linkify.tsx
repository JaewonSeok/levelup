import React from "react";

const URL_REGEX = /(https?:\/\/[^\s<>"')\]]+)/g;

/**
 * 텍스트에서 URL을 찾아 클릭 가능한 <a> 태그로 변환합니다.
 * URL 외 텍스트는 그대로 <span>으로 감싸 XSS를 방지합니다.
 */
export function linkifyText(text: string): React.ReactNode[] {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    URL_REGEX.lastIndex = 0;
    if (URL_REGEX.test(part)) {
      URL_REGEX.lastIndex = 0;
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#2563EB", textDecoration: "underline" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#1D4ED8")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#2563EB")}
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
