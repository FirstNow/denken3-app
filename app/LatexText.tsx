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

  // 1. 改行ごとに分割して改行タグを維持
  const lines = content.split('\n');

  return (
    <span className={className}>
      {lines.map((line, lIdx) => {
        // $...$ で囲まれた数式部分を分割
        const parts = line.split(/(\$[^$]+\$)/g);

        return (
          <React.Fragment key={lIdx}>
            {parts.map((part, pIdx) => {
              if (part.startsWith('$') && part.endsWith('$')) {
                // 前後の $ を除去し、余分なエスケープ \\ を \ に置換
                let math = part.slice(1, -1).trim();
                math = math.replace(/\\\\/g, '\\');

                try {
                  const html = katex.renderToString(math, {
                    throwOnError: false,
                    displayMode: false,
                  });
                  return (
                    <span
                      key={pIdx}
                      className="inline-block px-1 align-baseline text-indigo-900"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  );
                } catch (e) {
                  return <span key={pIdx}>{part}</span>;
                }
              }
              return <span key={pIdx}>{part}</span>;
            })}
            {lIdx < lines.length - 1 && <br />}
          </React.Fragment>
        );
      })}
    </span>
  );
}