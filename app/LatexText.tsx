'use client';

import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface LatexTextProps {
  content: string;
  className?: string;
}

export default function LatexText({ content, className = '' }: LatexTextProps) {
  if (!content) return null;

  // $...$ で囲まれた数式部分を分割
  const parts = content.split(/(\$[^$]+\$)/g);

  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (part.startsWith('$') && part.endsWith('$')) {
          const math = part.slice(1, -1);
          try {
            const html = katex.renderToString(math, {
              throwOnError: false,
              displayMode: false,
            });
            return (
              <span
                key={index}
                className="inline-block px-1 align-baseline"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          } catch (e) {
            return <span key={index}>{part}</span>;
          }
        }
        return <React.Fragment key={index}>{part}</React.Fragment>;
      })}
    </span>
  );
}