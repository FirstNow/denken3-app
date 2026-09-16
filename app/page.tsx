'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import LatexText from './LatexText';

interface RawQuestion {
  id: string;
  category: string;
  sub_category?: string;
  priority_rank: string;
  frequency_score: number;
  question_text: string;
  options: string[];
  correct_option: number;
  explanation: string;
  law_reference: string;
}

interface DisplayQuestion extends RawQuestion {
  shuffledOptions: string[];
  shuffledCorrectIndex: number;
}

interface ExamSessionRecord {
  id: string;
  score: number;
  total_questions: number;
  correct_count: number;
  is_passed: boolean;
  question_snapshots: DisplayQuestion[];
  user_answers: { [key: number]: number };
  created_at: string;
}

const CATEGORIES = [
  { id: 'all', label: '全分野' },
  { id: '電気事業法', label: '電気事業法' },
  { id: '技術基準', label: '技術基準' },
  { id: '施設管理', label: '施設管理' },
] as const;

type CategoryFilter = (typeof CATEGORIES)[number]['id'];

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseOptionItems(text: string) {
  if (text.includes('|')) {
    return text.split('|').map((t) => t.trim());
  }
  const parts = text.split(/(?=[（(]?[アイウエオ][）)]?[\s:：])/).map((t) => t.trim()).filter(Boolean);
  if (parts.length >= 2) return parts;
  return null;
}

export default function Home() {
  const [mode, setMode] = useState<'all' | 'review' | 'exam' | 'history'>('all');
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all');
  const [questions, setQuestions] = useState<DisplayQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [loading, setLoading] = useState(true);

  // 模試ステート
  const [examAnswers, setExamAnswers] = useState<{ [qIndex: number]: number }>({});
  const [isExamFinished, setIsExamFinished] = useState(false);

  // 過去10回の模試履歴
  const [examHistory, setExamHistory] = useState<ExamSessionRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<ExamSessionRecord | null>(null);

  // ユーザー統計
  const [totalAnsweredCount, setTotalAnsweredCount] = useState(0);
  const [totalCorrectCount, setTotalCorrectCount] = useState(0);

  // 認証
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserStats = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('user_answers')
      .select('is_correct')
      .eq('user_id', userId);

    if (!error && data) {
      setTotalAnsweredCount(data.length);
      setTotalCorrectCount(data.filter((d) => d.is_correct).length);
    }
  }, []);

  // 過去10回分の模試履歴を取得
  const fetchExamHistory = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('exam_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!error && data) {
      setExamHistory(data as ExamSessionRecord[]);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchUserStats(user.id);
      fetchExamHistory(user.id);
    } else {
      setTotalAnsweredCount(0);
      setTotalCorrectCount(0);
      setExamHistory([]);
    }
  }, [user, fetchUserStats, fetchExamHistory]);

  const loadQuestions = useCallback(async () => {
    if (mode === 'history') return;

    setLoading(true);
    setCurrentIndex(0);
    setSelectedOption(null);
    setIsAnswered(false);
    setExamAnswers({});
    setIsExamFinished(false);

    let rawList: RawQuestion[] = [];

    if (mode === 'all') {
      let query = supabase
        .from('questions')
        .select('*')
        .order('priority_rank', { ascending: true })
        .order('frequency_score', { ascending: false });

      if (selectedCategory !== 'all') {
        query = query.ilike('category', `%${selectedCategory}%`);
      }

      const { data } = await query;
      rawList = data || [];
    } else if (mode === 'review') {
      if (!user) {
        setQuestions([]);
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('user_question_status')
        .select('question_id, questions (*)')
        .eq('user_id', user.id)
        .eq('is_wrong', true);

      rawList = (data?.map((item: any) => item.questions).filter(Boolean) as RawQuestion[]) || [];
    } else if (mode === 'exam') {
      // 模試モード：全問題プールからランダム10問
      const { data } = await supabase.from('questions').select('*');
      if (data) {
        rawList = shuffleArray(data).slice(0, 10);
      }
    }

    const preparedList: DisplayQuestion[] = rawList.map((q) => {
      const originalCorrectText = q.options[q.correct_option - 1];
      const shuffled = shuffleArray(q.options);
      const newCorrectIndex = shuffled.indexOf(originalCorrectText);

      return {
        ...q,
        shuffledOptions: shuffled,
        shuffledCorrectIndex: newCorrectIndex,
      };
    });

    setQuestions(preparedList);
    setLoading(false);
  }, [mode, selectedCategory, user]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  const currentQ = questions[currentIndex];
  const isCorrect = selectedOption === currentQ?.shuffledCorrectIndex;

  const examResult = useMemo(() => {
    if (mode !== 'exam' || !isExamFinished) return null;
    let correctCount = 0;
    questions.forEach((q, idx) => {
      if (examAnswers[idx] === q.shuffledCorrectIndex) {
        correctCount += 1;
      }
    });
    const score = Math.round((correctCount / (questions.length || 1)) * 100);
    return {
      score,
      correctCount,
      total: questions.length,
      isPassed: score >= 60,
    };
  }, [mode, isExamFinished, questions, examAnswers]);

  // 模試終了時にセッションをSupabaseへ自動保存
  const saveExamSession = useCallback(
    async (finalAnswers: { [key: number]: number }) => {
      if (!user || questions.length === 0) return;
      let correctCount = 0;
      questions.forEach((q, idx) => {
        if (finalAnswers[idx] === q.shuffledCorrectIndex) {
          correctCount += 1;
        }
      });
      const score = Math.round((correctCount / questions.length) * 100);
      const isPassed = score >= 60;

      await supabase.from('exam_sessions').insert({
        user_id: user.id,
        score,
        total_questions: questions.length,
        correct_count: correctCount,
        is_passed: isPassed,
        question_snapshots: questions,
        user_answers: finalAnswers,
      });

      fetchExamHistory(user.id);
    },
    [user, questions, fetchExamHistory]
  );

  const handleJudge = async () => {
    if (selectedOption === null || !currentQ) return;

    if (mode === 'exam') {
      const nextAnswers = { ...examAnswers, [currentIndex]: selectedOption };
      setExamAnswers(nextAnswers);

      if (currentIndex < questions.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setSelectedOption(examAnswers[currentIndex + 1] ?? null);
      } else {
        setIsExamFinished(true);
        saveExamSession(nextAnswers);
      }
      return;
    }

    setIsAnswered(true);

    if (user) {
      const correct = selectedOption === currentQ.shuffledCorrectIndex;
      await supabase.from('user_answers').insert({
        user_id: user.id,
        question_id: currentQ.id,
        selected_option: selectedOption + 1,
        is_correct: correct,
      });

      await supabase.from('user_question_status').upsert(
        {
          user_id: user.id,
          question_id: currentQ.id,
          is_wrong: !correct,
          last_answered_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,question_id' }
      );

      fetchUserStats(user.id);
    }
  };

  const handleNext = () => {
    setSelectedOption(null);
    setIsAnswered(false);
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      alert(mode === 'review' ? '復習対象の問題をすべて解き終えました！' : 'この分野の問題をすべて解き終えました！');
      loadQuestions();
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      setShowAuthModal(false);
      setEmail('');
      setPassword('');
    } catch (err: any) {
      setAuthError(err.message || '認証エラーが発生しました');
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-800">電験三種 法規マスター</h1>
            <p className="text-[11px] text-slate-500 truncate max-w-[200px]">
              {user ? user.email : '未ログイン（履歴保存なし）'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <button
                onClick={() => supabase.auth.signOut()}
                className="text-xs px-2.5 py-1.5 rounded-lg font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 active:scale-95 transition"
              >
                ログアウト
              </button>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition"
              >
                ログイン
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-4">
        {user && (
          <div className="bg-white rounded-xl p-3.5 mb-4 border border-slate-200 shadow-sm grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-semibold text-slate-400">総解答回数</p>
              <p className="text-lg font-extrabold text-slate-800">{totalAnsweredCount} <span className="text-xs font-normal">回</span></p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400">累計正答率</p>
              <p className="text-lg font-extrabold text-emerald-600">
                {totalAnsweredCount > 0 ? Math.round((totalCorrectCount / totalAnsweredCount) * 100) : 0}
                <span className="text-xs font-normal text-slate-600"> %</span>
              </p>
            </div>
          </div>
        )}

        {/* 4モード切り替え */}
        <div className="grid grid-cols-4 gap-1 p-1 bg-slate-200/70 rounded-xl mb-3 text-xs font-bold">
          <button
            onClick={() => setMode('all')}
            className={`py-2 rounded-lg transition ${
              mode === 'all' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            頻出演習
          </button>
          <button
            onClick={() => {
              if (!user) {
                alert('復習モードを利用するにはログインが必要です。');
                setShowAuthModal(true);
                return;
              }
              setMode('review');
            }}
            className={`py-2 rounded-lg transition ${
              mode === 'review' ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            要復習
          </button>
          <button
            onClick={() => setMode('exam')}
            className={`py-2 rounded-lg transition ${
              mode === 'exam' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            模擬試験
          </button>
          <button
            onClick={() => {
              if (!user) {
                alert('模試履歴を確認するにはログインが必要です。');
                setShowAuthModal(true);
                return;
              }
              setMode('history');
            }}
            className={`py-2 rounded-lg transition ${
              mode === 'history' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            過去模試10
          </button>
        </div>

        {/* 分野別セレクター */}
        {mode === 'all' && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-none">
            {CATEGORIES.map((cat) => {
              const isActive = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border transition ${
                    isActive
                      ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        )}

        {/* 過去10回分の模試見直しモード画面 */}
        {mode === 'history' && (
          <div className="space-y-4 mb-6">
            <h2 className="text-sm font-bold text-slate-700">過去10回の模擬試験 記録一覧</h2>
            {examHistory.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 text-xs text-slate-400">
                まだ保存された模試結果がありません。「模擬試験」を受けてみましょう！
              </div>
            ) : selectedSession ? (
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                <button
                  onClick={() => setSelectedSession(null)}
                  className="text-xs font-bold text-blue-600 mb-3 block"
                >
                  ← 模試履歴一覧に戻る
                </button>
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                  <div>
                    <span className="text-xs text-slate-400">
                      {new Date(selectedSession.created_at).toLocaleString('ja-JP')} 実施
                    </span>
                    <p className={`text-xl font-black ${selectedSession.is_passed ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {selectedSession.score} 点
                      <span className="text-xs font-normal text-slate-500 ml-2">
                        ({selectedSession.correct_count} / {selectedSession.total_questions} 問正解)
                      </span>
                    </p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${selectedSession.is_passed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                    {selectedSession.is_passed ? '合格' : '不合格'}
                  </span>
                </div>

                <div className="space-y-4">
                  {selectedSession.question_snapshots.map((q, idx) => {
                    const userChoice = selectedSession.user_answers[idx];
                    const isItemCorrect = userChoice === q.shuffledCorrectIndex;
                    return (
                      <div key={idx} className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs">
                        <div className="flex items-center justify-between font-bold mb-2">
                          <span>第 {idx + 1} 問 ({q.category})</span>
                          <span className={isItemCorrect ? 'text-emerald-600' : 'text-rose-600'}>
                            {isItemCorrect ? '⭕ 正解' : '❌ 不正解'}
                          </span>
                        </div>
                        <p className="font-medium text-slate-800 mb-2">
                          <LatexText content={q.question_text} />
                        </p>
                        <div className="space-y-1 mb-3">
                          {q.shuffledOptions.map((opt, oIdx) => (
                            <div
                              key={oIdx}
                              className={`p-2 rounded border ${
                                oIdx === q.shuffledCorrectIndex
                                  ? 'bg-emerald-50 border-emerald-300 font-bold text-emerald-900'
                                  : oIdx === userChoice
                                  ? 'bg-rose-50 border-rose-300 line-through text-rose-800'
                                  : 'bg-white border-slate-100 text-slate-600'
                              }`}
                            >
                              ({oIdx + 1}) <LatexText content={opt} />
                            </div>
                          ))}
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-slate-100 text-slate-700 leading-relaxed">
                          <span className="font-bold block text-slate-500 mb-1">解説:</span>
                          <LatexText content={q.explanation} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {examHistory.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedSession(item)}
                    className="w-full text-left p-4 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center justify-between hover:bg-slate-50 transition"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-sm text-slate-800">第 {examHistory.length - index} 回 模試</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded font-bold ${item.is_passed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                          {item.is_passed ? '合格' : '不合格'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        {new Date(item.created_at).toLocaleString('ja-JP')}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`text-xl font-extrabold ${item.is_passed ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {item.score} <span className="text-xs text-slate-400 font-normal">点</span>
                      </span>
                      <p className="text-[11px] text-slate-400">見直す →</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 通常出題・模試出題画面 */}
        {mode !== 'history' && questions.length > 0 && !isExamFinished && (
          <div className="mb-4">
            <div className="flex justify-between items-center text-xs font-bold text-slate-500 mb-1.5">
              <span>
                {mode === 'exam'
                  ? '本試験形式 模試'
                  : mode === 'review'
                  ? '弱点復習'
                  : `${CATEGORIES.find((c) => c.id === selectedCategory)?.label}`}
              </span>
              <span>{currentIndex + 1} / {questions.length} 問</span>
            </div>
            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  mode === 'exam' ? 'bg-indigo-600' : mode === 'review' ? 'bg-rose-500' : 'bg-blue-600'
                }`}
                style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* 模試直後採点結果 */}
        {mode === 'exam' && isExamFinished && examResult && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm text-center mb-6">
            <span className="text-4xl mb-2 inline-block">{examResult.isPassed ? '🎉' : '📚'}</span>
            <h2 className="text-xl font-bold text-slate-800 mb-1">模擬試験 結果発表</h2>
            <p className={`text-2xl font-black mb-4 ${examResult.isPassed ? 'text-emerald-600' : 'text-rose-600'}`}>
              {examResult.score} 点
              <span className="text-xs font-semibold ml-2 text-slate-500">
                ({examResult.correctCount} / {examResult.total} 問正解)
              </span>
            </p>

            <div className={`p-3 rounded-lg text-sm font-bold mb-6 ${examResult.isPassed ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
              {examResult.isPassed ? '合格基準（60点）達成！この調子で盤石にしましょう。' : '合格基準（60点）未満です。間違えた問題を復習モードで固めましょう。'}
            </div>

            <div className="text-left space-y-3 mb-6">
              <p className="text-xs font-bold text-slate-500">各問の採点結果</p>
              {questions.map((q, idx) => {
                const userChoice = examAnswers[idx];
                const isItemCorrect = userChoice === q.shuffledCorrectIndex;
                return (
                  <div key={q.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                    <div className="flex items-center justify-between mb-1 font-bold">
                      <span>第 {idx + 1} 問 ({q.category})</span>
                      <span className={isItemCorrect ? 'text-emerald-600' : 'text-rose-600'}>
                        {isItemCorrect ? '⭕ 正解' : '❌ 不正解'}
                      </span>
                    </div>
                    <LatexText content={q.question_text} className="text-slate-600 line-clamp-1 block" />
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => loadQuestions()}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl active:scale-[0.98] transition shadow"
            >
              もう一度模試に挑戦する
            </button>
          </div>
        )}

        {/* 出題カード */}
        {mode !== 'history' && !isExamFinished && currentQ && (
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm mb-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] px-2 py-0.5 rounded font-bold bg-slate-100 text-slate-700">
                {currentQ.category}
              </span>
              {currentQ.sub_category && (
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600">
                  {currentQ.sub_category}
                </span>
              )}
            </div>

            <div className="text-[15px] sm:text-base text-slate-800 font-medium leading-relaxed mb-6 whitespace-pre-wrap">
              <LatexText content={currentQ.question_text} />
            </div>

            <div className="space-y-2.5">
              {currentQ.shuffledOptions.map((optText, idx) => {
                const isSelected = selectedOption === idx;
                const parsedCells = parseOptionItems(optText);

                let itemStyle = 'border-slate-200 bg-white text-slate-700 active:bg-slate-100';
                if (isSelected) {
                  itemStyle = 'border-blue-500 bg-blue-50 text-blue-900 ring-2 ring-blue-400 font-semibold';
                }

                if (isAnswered && mode !== 'exam') {
                  if (idx === currentQ.shuffledCorrectIndex) {
                    itemStyle = 'border-emerald-500 bg-emerald-50 text-emerald-900 font-bold';
                  } else if (isSelected) {
                    itemStyle = 'border-rose-500 bg-rose-50 text-rose-800 line-through';
                  }
                }

                return (
                  <button
                    key={idx}
                    onClick={() => {
                      if (!isAnswered || mode === 'exam') setSelectedOption(idx);
                    }}
                    className={`w-full text-left p-3 sm:p-3.5 rounded-xl border min-h-[50px] transition-all flex items-center gap-3 ${itemStyle}`}
                  >
                    <span className="shrink-0 font-bold text-sm w-7 text-center">({idx + 1})</span>

                    {parsedCells ? (
                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs sm:text-sm">
                        {parsedCells.map((cell, cIdx) => (
                          <span key={cIdx} className="bg-slate-100/80 px-2 py-1 rounded text-slate-800 font-medium">
                            <LatexText content={cell} />
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm leading-snug flex-1">
                        <LatexText content={optText} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-6">
              {mode === 'exam' ? (
                <button
                  onClick={handleJudge}
                  disabled={selectedOption === null}
                  className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold rounded-xl active:scale-[0.98] transition shadow-sm"
                >
                  {currentIndex < questions.length - 1 ? '次の問題へ' : '試験を終了して保存・採点'}
                </button>
              ) : !isAnswered ? (
                <button
                  onClick={handleJudge}
                  disabled={selectedOption === null}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-xl active:scale-[0.98] transition shadow-sm"
                >
                  回答する
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  className="w-full py-3.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl active:scale-[0.98] transition shadow-sm"
                >
                  {currentIndex < questions.length - 1 ? '次の問題へ' : 'この分野を完了する'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 解説 */}
        {mode !== 'history' && mode !== 'exam' && isAnswered && currentQ && (
          <div className={`p-5 rounded-2xl border mb-6 ${isCorrect ? 'bg-emerald-50/70 border-emerald-200' : 'bg-rose-50/70 border-rose-200'}`}>
            <span className={`text-base font-bold block mb-1 ${isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
              {isCorrect ? '⭕ 正解！' : '❌ 不正解...'}
            </span>
            <p className="text-xs font-semibold text-slate-500 mb-2">
              根拠法令: {currentQ.law_reference || '条文参照'}
            </p>
            <div className="text-xs sm:text-sm text-slate-700 leading-relaxed bg-white p-3.5 rounded-xl border border-slate-100 whitespace-pre-wrap">
              <LatexText content={currentQ.explanation} />
            </div>
          </div>
        )}
      </div>

      {/* 認証モーダル */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100">
            <h2 className="text-base font-bold text-slate-800 mb-3">
              {isSignUp ? '新規アカウント登録' : 'ログイン'}
            </h2>
            {authError && (
              <div className="mb-3 p-2.5 bg-rose-50 text-rose-700 text-xs rounded-lg border border-rose-200">
                {authError}
              </div>
            )}
            <form onSubmit={handleAuth} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">メールアドレス</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="example@mail.com"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">パスワード</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="6文字以上"
                  minLength={6}
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition mt-1"
              >
                {isSignUp ? '登録する' : 'ログイン'}
              </button>
            </form>
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-xs text-blue-600 hover:underline font-medium"
              >
                {isSignUp ? '登録済みの方はこちら（ログイン）' : '初めての方はこちら（新規登録）'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowAuthModal(false)}
              className="mt-3 w-full py-2 text-xs text-slate-400 hover:text-slate-600"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </main>
  );
}