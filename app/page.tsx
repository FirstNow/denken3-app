'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';

interface Question {
  id: string;
  category: string;
  priority_rank: string;
  question_text: string;
  options: string[];
  correct_option: number;
  explanation: string;
  law_reference: string;
}

export default function Home() {
  const [mode, setMode] = useState<'all' | 'review'>('all');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [loading, setLoading] = useState(true);

  // 認証関連
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // 1. ログイン状態の監視
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2. 問題の読み込み（通常モード or 復習モード）
  const loadQuestions = useCallback(async () => {
    setLoading(true);
    setCurrentIndex(0);
    setSelectedOption(null);
    setIsAnswered(false);

    if (mode === 'all') {
      // 頻出順に出題
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .order('priority_rank', { ascending: true })
        .order('frequency_score', { ascending: false });

      if (error) {
        console.error('取得エラー:', error);
      } else {
        setQuestions(data || []);
      }
    } else {
      // 復習モード：is_wrong が true の問題のみ取得
      if (!user) {
        setQuestions([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_question_status')
        .select(`
          question_id,
          questions (*)
        `)
        .eq('user_id', user.id)
        .eq('is_wrong', true);

      if (error) {
        console.error('復習問題取得エラー:', error);
      } else if (data) {
        // questionsの配列に整形
        const reviewQuestions = data
          .map((item: any) => item.questions)
          .filter(Boolean) as Question[];
        setQuestions(reviewQuestions);
      }
    }
    setLoading(false);
  }, [mode, user]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  // 認証処理
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setMode('all');
  };

  const currentQ = questions[currentIndex];
  const isCorrect = selectedOption === currentQ?.correct_option;

  const handleSelectOption = (index: number) => {
    if (isAnswered) return;
    setSelectedOption(index + 1);
  };

  // 解答確定＆Supabaseへ履歴と復習ステータスを保存
  const handleJudge = async () => {
    if (selectedOption === null || !currentQ) return;
    setIsAnswered(true);

    // ログイン中の場合、データベースに記録
    if (user) {
      const correct = selectedOption === currentQ.correct_option;

      // ① user_answers（全履歴）へ保存
      await supabase.from('user_answers').insert({
        user_id: user.id,
        question_id: currentQ.id,
        selected_option: selectedOption,
        is_correct: correct,
      });

      // ② user_question_status（復習ステータス）をUpsert
      // 不正解なら is_wrong = true、正解なら is_wrong = false（克服）
      await supabase.from('user_question_status').upsert(
        {
          user_id: user.id,
          question_id: currentQ.id,
          is_wrong: !correct,
          last_answered_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,question_id' }
      );
    }
  };

  const handleNext = () => {
    setSelectedOption(null);
    setIsAnswered(false);
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      alert(mode === 'review' ? '復習対象の問題をすべて解き終えました！' : 'すべての問題を解き終えました！');
      loadQuestions();
    }
  };

  return (
    <main className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* ヘッダーエリア */}
        <header className="mb-6 flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div>
            <h1 className="text-lg font-bold text-gray-800">電験三種 法規マスター</h1>
            <p className="text-xs text-gray-500">
              {user ? `ログイン中: ${user.email}` : '未ログイン（履歴を保存するにはログインしてください）'}
            </p>
          </div>

          <div>
            {user ? (
              <button
                onClick={handleLogout}
                className="text-xs font-semibold px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition"
              >
                ログアウト
              </button>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="text-xs font-semibold px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
              >
                ログイン / 登録
              </button>
            )}
          </div>
        </header>

        {/* モード切り替えタブ */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('all')}
            className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition ${
              mode === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            頻出順演習
          </button>
          <button
            onClick={() => {
              if (!user) {
                alert('復習機能を利用するにはログインが必要です。');
                setShowAuthModal(true);
                return;
              }
              setMode('review');
            }}
            className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition ${
              mode === 'review'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            間違えた問題を復習
          </button>
        </div>

        {/* 状態表示 */}
        <div className="flex justify-between items-center mb-3 text-xs font-bold text-gray-500">
          <span>{mode === 'all' ? '全問演習（頻出度順）' : '復習モード（間違えた問題）'}</span>
          {questions.length > 0 && (
            <span>{currentIndex + 1} / {questions.length} 問</span>
          )}
        </div>

        {/* メインコンテンツ */}
        {loading ? (
          <div className="bg-white rounded-xl p-10 text-center text-gray-400 text-sm">
            読み込み中...
          </div>
        ) : questions.length === 0 ? (
          <div className="bg-white rounded-xl p-10 text-center border border-gray-200 shadow-sm">
            <p className="text-gray-700 font-bold mb-2">
              {mode === 'review' ? '復習する問題はありません 🎉' : '問題が登録されていません。'}
            </p>
            <p className="text-xs text-gray-500 mb-4">
              {mode === 'review' && '間違えた問題があるとここに自動でリストアップされます。'}
            </p>
            {mode === 'review' && (
              <button
                onClick={() => setMode('all')}
                className="text-xs font-semibold px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
              >
                全問演習に戻る
              </button>
            )}
          </div>
        ) : (
          /* 問題カード */
          currentQ && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <span className={`text-xs px-2.5 py-1 rounded font-bold ${
                  mode === 'review' ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'
                }`}>
                  {mode === 'review' ? '要復習' : `頻出ランク ${currentQ.priority_rank}`}
                </span>
                <span className="text-xs text-gray-500 font-medium">
                  {currentQ.category}
                </span>
              </div>

              <p className="text-gray-800 text-base leading-relaxed font-medium mb-6 whitespace-pre-wrap">
                {currentQ.question_text}
              </p>

              {/* 選択肢 */}
              <div className="space-y-3">
                {currentQ.options.map((optionText, idx) => {
                  const optionNumber = idx + 1;
                  const isSelected = selectedOption === optionNumber;

                  let btnStyle = 'border-gray-200 hover:bg-gray-50 text-gray-700';
                  if (isSelected) {
                    btnStyle = 'border-blue-500 bg-blue-50 text-blue-900 font-medium ring-2 ring-blue-400';
                  }
                  if (isAnswered) {
                    if (optionNumber === currentQ.correct_option) {
                      btnStyle = 'border-emerald-500 bg-emerald-50 text-emerald-900 font-bold';
                    } else if (isSelected) {
                      btnStyle = 'border-rose-500 bg-rose-50 text-rose-900 line-through';
                    }
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelectOption(idx)}
                      disabled={isAnswered}
                      className={`w-full text-left p-4 rounded-lg border transition-all duration-150 flex items-start gap-3 ${btnStyle}`}
                    >
                      <span className="font-semibold shrink-0">({optionNumber})</span>
                      <span>{optionText}</span>
                    </button>
                  );
                })}
              </div>

              {/* ボタン */}
              {!isAnswered ? (
                <button
                  onClick={handleJudge}
                  disabled={selectedOption === null}
                  className="mt-6 w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition"
                >
                  回答する
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  className="mt-6 w-full py-3 px-4 bg-gray-800 hover:bg-gray-900 text-white font-semibold rounded-lg transition"
                >
                  {currentIndex < questions.length - 1 ? '次の問題へ' : '演習を終了する'}
                </button>
              )}
            </div>
          )
        )}

        {/* 解説 */}
        {isAnswered && currentQ && (
          <div className={`p-6 rounded-xl border mb-6 ${isCorrect ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-lg font-bold ${isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
                {isCorrect ? '⭕ 正解！' : '❌ 不正解...'}
              </span>
            </div>
            <p className="text-xs font-semibold text-gray-500 mb-3">
              根拠法令: {currentQ.law_reference || '条文参照'}
            </p>
            <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-white p-4 rounded border border-gray-100">
              {currentQ.explanation}
            </div>
          </div>
        )}

        {/* 認証モーダル */}
        {showAuthModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl">
              <h2 className="text-lg font-bold text-gray-800 mb-4">
                {isSignUp ? '新規アカウント登録' : 'ログイン'}
              </h2>

              {authError && (
                <div className="mb-4 p-3 bg-rose-50 text-rose-700 text-xs rounded border border-rose-200">
                  {authError}
                </div>
              )}

              <form onSubmit={handleAuth} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">メールアドレス</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-2.5 border rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="example@mail.com"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">パスワード</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-2.5 border rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="6文字以上のパスワード"
                    minLength={6}
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition"
                >
                  {isSignUp ? '登録する' : 'ログイン'}
                </button>
              </form>

              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(!isSignUp);
                    setAuthError('');
                  }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {isSignUp ? 'すでにアカウントをお持ちの方（ログイン）' : '初めての方はこちら（新規登録）'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowAuthModal(false)}
                className="mt-4 w-full py-2 text-xs text-gray-500 hover:text-gray-700"
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}