import { useEffect, useRef, useState, useCallback } from 'react'
import './App.css'

interface Card {
  front: string
  back: string
}

interface Score {
  correct: number
  total: number
  results: boolean[] // per-card results in order
}

interface DeckState {
  deckId: string
  topic: string
  cards: Card[]
  currentCard: number
  score: Score
  showingBack: boolean
  lastResult: 'correct' | 'incorrect' | null
  completed: boolean
  selfStudyMode: boolean
  shuffledOrder: number[] // indices into cards[] in current study order
  cardResults: Map<number, 'correct' | 'incorrect'> // keyed by shuffledOrder position
}

const TOOL_SCHEMAS = [
  {
    name: 'create_deck',
    description: 'Creates a new flashcard deck with a topic and array of cards',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The topic of the flashcard deck' },
        cards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              front: { type: 'string', description: 'The question or prompt on the front of the card' },
              back: { type: 'string', description: 'The answer on the back of the card' },
            },
            required: ['front', 'back'],
          },
          description: 'Array of flashcard objects with front and back text',
        },
      },
      required: ['topic', 'cards'],
    },
  },
  {
    name: 'show_card',
    description: 'Shows a specific card to the student by index, optionally revealing the back',
    parameters: {
      type: 'object',
      properties: {
        cardIndex: { type: 'number', description: 'Zero-based index of the card to show' },
        side: {
          type: 'string',
          enum: ['front', 'both'],
          description: 'Whether to show just the front or both sides',
        },
      },
      required: ['cardIndex', 'side'],
    },
  },
  {
    name: 'check_answer',
    description: "Checks the student's answer against the card's back text using fuzzy matching",
    parameters: {
      type: 'object',
      properties: {
        cardIndex: { type: 'number', description: 'Zero-based index of the card being answered' },
        studentAnswer: { type: 'string', description: "The student's answer to check" },
      },
      required: ['cardIndex', 'studentAnswer'],
    },
  },
  {
    name: 'get_score',
    description: 'Returns the current quiz score and per-card results',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'reset_deck',
    description: 'Clears the current deck and score, returning to idle state',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
]

function fuzzyMatch(student: string, correct: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '')
  const s = normalize(student)
  const c = normalize(correct)
  if (s === c) return true
  // Check if the student answer contains the correct answer or vice versa
  if (s.includes(c) || c.includes(s)) return true
  return false
}

function generateDeckId(): string {
  return 'deck_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function shuffleArray(arr: number[]): number[] {
  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

function createInitialOrder(length: number): number[] {
  return Array.from({ length }, (_, i) => i)
}

export default function App() {
  const [deck, setDeck] = useState<DeckState | null>(null)
  const deckRef = useRef<DeckState | null>(null)
  deckRef.current = deck
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sendStateUpdate = useCallback((d: DeckState) => {
    const correctCount = Array.from(d.cardResults.values()).filter(r => r === 'correct').length
    const attemptedCount = d.cardResults.size
    window.parent.postMessage({
      type: 'state_update',
      state: {
        topic: d.topic,
        cardCount: d.cards.length,
        currentCard: d.currentCard,
        totalCards: d.cards.length,
        score: { correct: correctCount, total: attemptedCount },
        selfStudyMode: d.selfStudyMode,
        completed: d.completed,
        ...(d.selfStudyMode && d.cards[d.shuffledOrder[d.currentCard]] ? {
          lastAction: 'self_graded',
          lastCardFront: d.cards[d.shuffledOrder[d.currentCard]].front,
        } : {}),
      },
    }, '*')
  }, [])

  const sendCompletion = useCallback((d: DeckState) => {
    const correctCount = Array.from(d.cardResults.values()).filter(r => r === 'correct').length
    const percentage = d.cards.length > 0
      ? Math.round((correctCount / d.cards.length) * 100)
      : 0
    window.parent.postMessage({
      type: 'completion',
      result: {
        topic: d.topic,
        correct: correctCount,
        total: d.cards.length,
        percentage,
        summary: `Quiz complete: ${correctCount}/${d.cards.length} correct (${percentage}%)`,
      },
    }, '*')
  }, [])

  // Cleanup auto-advance timer
  useEffect(() => {
    return () => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current)
    }
  }, [])

  // Send ready + register tools on mount
  useEffect(() => {
    window.parent.postMessage({ type: 'ready' }, '*')
    window.parent.postMessage({ type: 'register_tools', schemas: TOOL_SCHEMAS }, '*')
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const current = deckRef.current
      if (!current || current.completed) return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        navigatePrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        navigateNext()
      } else if (e.key === ' ') {
        e.preventDefault()
        flipCard()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const navigateNext = useCallback(() => {
    const current = deckRef.current
    if (!current || current.completed) return
    if (current.currentCard >= current.cards.length - 1) return

    const updated: DeckState = {
      ...current,
      currentCard: current.currentCard + 1,
      showingBack: false,
      lastResult: null,
      selfStudyMode: true,
    }
    setDeck(updated)
  }, [])

  const navigatePrev = useCallback(() => {
    const current = deckRef.current
    if (!current || current.completed) return
    if (current.currentCard <= 0) return

    const updated: DeckState = {
      ...current,
      currentCard: current.currentCard - 1,
      showingBack: false,
      lastResult: null,
      selfStudyMode: true,
    }
    setDeck(updated)
  }, [])

  const flipCard = useCallback(() => {
    const current = deckRef.current
    if (!current || current.completed) return

    const updated: DeckState = {
      ...current,
      showingBack: !current.showingBack,
      selfStudyMode: true,
    }
    setDeck(updated)
  }, [])

  const selfGrade = useCallback((result: 'correct' | 'incorrect') => {
    const current = deckRef.current
    if (!current || current.completed) return

    const newCardResults = new Map(current.cardResults)
    newCardResults.set(current.currentCard, result)

    // Also update the score.results array for compatibility with tool-driven grading
    const actualCardIndex = current.shuffledOrder[current.currentCard]
    const newResults = [...current.score.results]
    newResults[actualCardIndex] = result === 'correct'

    const correctCount = Array.from(newCardResults.values()).filter(r => r === 'correct').length
    const attemptedCount = newCardResults.size
    const allAnswered = attemptedCount >= current.cards.length

    const updated: DeckState = {
      ...current,
      selfStudyMode: true,
      lastResult: result,
      cardResults: newCardResults,
      score: {
        correct: correctCount,
        total: attemptedCount,
        results: newResults,
      },
      completed: allAnswered,
    }
    setDeck(updated)
    sendStateUpdate(updated)

    if (allAnswered) {
      sendCompletion(updated)
    } else {
      // Auto-advance after 500ms
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current)
      autoAdvanceTimer.current = setTimeout(() => {
        const latest = deckRef.current
        if (!latest || latest.completed) return
        if (latest.currentCard < latest.cards.length - 1) {
          const next: DeckState = {
            ...latest,
            currentCard: latest.currentCard + 1,
            showingBack: false,
            lastResult: null,
            selfStudyMode: true,
          }
          setDeck(next)
        }
      }, 500)
    }
  }, [sendStateUpdate, sendCompletion])

  const handleShuffle = useCallback(() => {
    const current = deckRef.current
    if (!current) return

    const newOrder = shuffleArray(createInitialOrder(current.cards.length))
    // Reorder cards according to the new shuffle
    const shuffledCards = newOrder.map(i => current.cards[i])

    const updated: DeckState = {
      ...current,
      cards: shuffledCards,
      shuffledOrder: createInitialOrder(shuffledCards.length),
      currentCard: 0,
      showingBack: false,
      lastResult: null,
      selfStudyMode: true,
    }
    setDeck(updated)
  }, [])

  const handleRestart = useCallback(() => {
    const current = deckRef.current
    if (!current) return

    const updated: DeckState = {
      ...current,
      currentCard: 0,
      showingBack: false,
      lastResult: null,
      completed: false,
      selfStudyMode: true,
      cardResults: new Map(),
      score: { correct: 0, total: 0, results: [] },
    }
    setDeck(updated)
  }, [])

  const handleShuffleRestart = useCallback(() => {
    const current = deckRef.current
    if (!current) return

    const newOrder = shuffleArray(createInitialOrder(current.cards.length))
    const shuffledCards = newOrder.map(i => current.cards[i])

    const updated: DeckState = {
      ...current,
      cards: shuffledCards,
      shuffledOrder: createInitialOrder(shuffledCards.length),
      currentCard: 0,
      showingBack: false,
      lastResult: null,
      completed: false,
      selfStudyMode: true,
      cardResults: new Map(),
      score: { correct: 0, total: 0, results: [] },
    }
    setDeck(updated)
  }, [])

  // Message handler
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data || typeof event.data.type !== 'string') return
      if (event.data.type !== 'tool_invoke') return

      const { toolCallId, toolName, params } = event.data as {
        toolCallId: string
        toolName: string
        params: Record<string, unknown>
      }

      const current = deckRef.current

      switch (toolName) {
        case 'create_deck': {
          const topic = params.topic as string
          const cards = params.cards as Card[]
          if (!topic || !Array.isArray(cards) || cards.length === 0) {
            window.parent.postMessage({
              type: 'tool_result',
              toolCallId,
              result: { error: 'topic and non-empty cards array are required' },
            }, '*')
            return
          }
          const deckId = generateDeckId()
          const newDeck: DeckState = {
            deckId,
            topic,
            cards,
            currentCard: 0,
            score: { correct: 0, total: 0, results: [] },
            showingBack: false,
            lastResult: null,
            completed: false,
            selfStudyMode: false,
            shuffledOrder: createInitialOrder(cards.length),
            cardResults: new Map(),
          }
          setDeck(newDeck)
          sendStateUpdate(newDeck)
          window.parent.postMessage({
            type: 'tool_result',
            toolCallId,
            result: { deckId, cardCount: cards.length },
          }, '*')
          break
        }

        case 'show_card': {
          if (!current) {
            window.parent.postMessage({
              type: 'tool_result',
              toolCallId,
              result: { error: 'No deck loaded. Use create_deck first.' },
            }, '*')
            return
          }
          const cardIndex = params.cardIndex as number
          const side = params.side as 'front' | 'both'
          if (cardIndex < 0 || cardIndex >= current.cards.length) {
            window.parent.postMessage({
              type: 'tool_result',
              toolCallId,
              result: { error: `Invalid cardIndex: ${cardIndex}. Deck has ${current.cards.length} cards.` },
            }, '*')
            return
          }
          const card = current.cards[cardIndex]
          const showBack = side === 'both'
          const updated: DeckState = {
            ...current,
            currentCard: cardIndex,
            showingBack: showBack,
            lastResult: null,
            selfStudyMode: false,
          }
          setDeck(updated)
          sendStateUpdate(updated)
          window.parent.postMessage({
            type: 'tool_result',
            toolCallId,
            result: {
              front: card.front,
              back: card.back,
              cardIndex,
              totalCards: current.cards.length,
            },
          }, '*')
          break
        }

        case 'check_answer': {
          if (!current) {
            window.parent.postMessage({
              type: 'tool_result',
              toolCallId,
              result: { error: 'No deck loaded. Use create_deck first.' },
            }, '*')
            return
          }
          const checkIndex = params.cardIndex as number
          const studentAnswer = params.studentAnswer as string
          if (checkIndex < 0 || checkIndex >= current.cards.length) {
            window.parent.postMessage({
              type: 'tool_result',
              toolCallId,
              result: { error: `Invalid cardIndex: ${checkIndex}` },
            }, '*')
            return
          }
          const targetCard = current.cards[checkIndex]
          const correct = fuzzyMatch(studentAnswer, targetCard.back)

          const newCardResults = new Map(current.cardResults)
          newCardResults.set(checkIndex, correct ? 'correct' : 'incorrect')

          const newResults = [...current.score.results]
          newResults[checkIndex] = correct
          const correctCount = Array.from(newCardResults.values()).filter(r => r === 'correct').length
          const attemptedCount = newCardResults.size
          const newScore: Score = {
            correct: correctCount,
            total: attemptedCount,
            results: newResults,
          }
          const allAnswered = newScore.total >= current.cards.length
          const checkedDeck: DeckState = {
            ...current,
            currentCard: checkIndex,
            showingBack: true,
            lastResult: correct ? 'correct' : 'incorrect',
            score: newScore,
            completed: allAnswered,
            selfStudyMode: false,
            cardResults: newCardResults,
          }
          setDeck(checkedDeck)
          sendStateUpdate(checkedDeck)

          window.parent.postMessage({
            type: 'tool_result',
            toolCallId,
            result: {
              correct,
              correctAnswer: targetCard.back,
              studentAnswer,
              score: {
                correct: newScore.correct,
                total: newScore.total,
              },
            },
          }, '*')

          if (allAnswered) {
            sendCompletion(checkedDeck)
          }
          break
        }

        case 'get_score': {
          if (!current) {
            window.parent.postMessage({
              type: 'tool_result',
              toolCallId,
              result: { correct: 0, total: 0, percentage: 0, cards: [] },
            }, '*')
            return
          }
          const correctCount = Array.from(current.cardResults.values()).filter(r => r === 'correct').length
          const pct = current.cards.length > 0
            ? Math.round((correctCount / current.cards.length) * 100)
            : 0
          window.parent.postMessage({
            type: 'tool_result',
            toolCallId,
            result: {
              correct: correctCount,
              total: current.cardResults.size,
              percentage: pct,
              cards: current.cards.map((c, i) => ({
                front: c.front,
                correct: current.cardResults.has(i)
                  ? current.cardResults.get(i) === 'correct'
                  : null,
              })),
            },
          }, '*')
          break
        }

        case 'reset_deck': {
          setDeck(null)
          window.parent.postMessage({
            type: 'tool_result',
            toolCallId,
            result: { status: 'reset' },
          }, '*')
          break
        }

        default:
          window.parent.postMessage({
            type: 'tool_result',
            toolCallId,
            result: { error: `Unknown tool: ${toolName}` },
          }, '*')
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [sendStateUpdate, sendCompletion])

  // Render idle state
  if (!deck) {
    return (
      <div className="flashcard-container">
        <div className="title">Flashcard Quiz</div>
        <div className="idle-message">
          Waiting for a flashcard deck...<br />
          Ask Claude to quiz you on any topic!
        </div>
      </div>
    )
  }

  const currentCard = deck.cards[deck.currentCard]
  const correctCount = Array.from(deck.cardResults.values()).filter(r => r === 'correct').length
  const attemptedCount = deck.cardResults.size
  const totalCards = deck.cards.length

  // Summary / completed screen
  if (deck.completed) {
    const pct = totalCards > 0 ? Math.round((correctCount / totalCards) * 100) : 0
    return (
      <div className="flashcard-container" style={{ position: 'relative' }}>
        <div className="title">Flashcard Quiz</div>
        <div className="topic-badge">{deck.topic}</div>
        <div className="percentage-big">{pct}%</div>
        <div style={{ fontSize: '14px', color: '#888', marginBottom: '8px' }}>
          {correctCount} of {totalCards} correct
        </div>
        <div className="summary-card">
          <h3>Results</h3>
          {deck.cards.map((c, i) => {
            const result = deck.cardResults.get(i)
            const isCorrect = result === 'correct'
            return (
              <div className="summary-row" key={i}>
                <span style={{ flex: 1 }}>{c.front}</span>
                <span className={isCorrect ? 'summary-icon-correct' : 'summary-icon-incorrect'}>
                  {isCorrect ? '\u2713' : '\u2717'}
                </span>
              </div>
            )
          })}
        </div>
        <div className="summary-actions">
          <button className="btn btn-primary" onClick={handleRestart}>
            Restart
          </button>
          <button className="btn btn-secondary" onClick={handleShuffleRestart}>
            Shuffle &amp; Restart
          </button>
        </div>
      </div>
    )
  }

  const hasBeenGraded = deck.cardResults.has(deck.currentCard)
  const isFirstCard = deck.currentCard <= 0
  const isLastCard = deck.currentCard >= totalCards - 1

  return (
    <div className="flashcard-container" style={{ position: 'relative' }}>
      <div className="score-tracker">
        <span className="correct">{correctCount}</span>
        <span className="total">/{attemptedCount} correct</span>
      </div>

      <div className="title">Flashcard Quiz</div>
      <div className="topic-badge">{deck.topic}</div>

      <div className="toolbar">
        <span className={`mode-indicator ${deck.selfStudyMode ? 'mode-self-study' : 'mode-guided'}`}>
          {deck.selfStudyMode ? 'Self-Study Mode' : 'Guided Mode'}
        </span>
        <button className="btn btn-small btn-shuffle" onClick={handleShuffle} title="Shuffle cards">
          Shuffle
        </button>
      </div>

      <div className="card-progress">
        Card {deck.currentCard + 1} of {totalCards}
      </div>

      {currentCard && (
        <div className="card-scene" onClick={flipCard} role="button" tabIndex={0} aria-label="Click to flip card">
          <div className={`card ${deck.showingBack ? 'flipped' : ''}`}>
            <div className="card-face card-front">
              <span className="card-label">Question</span>
              {currentCard.front}
            </div>
            <div className="card-face card-back">
              <span className="card-label">Answer</span>
              {currentCard.back}
            </div>
          </div>
        </div>
      )}

      {deck.lastResult && (
        <div className={`result-banner ${deck.lastResult === 'correct' ? 'result-correct' : 'result-incorrect'}`}>
          {deck.lastResult === 'correct' ? 'Correct!' : `Incorrect - Answer: ${currentCard?.back}`}
        </div>
      )}

      {/* Self-grading buttons: show when card is flipped and not yet graded */}
      {deck.showingBack && !hasBeenGraded && (
        <div className="grading-buttons">
          <button className="btn btn-got-it" onClick={() => selfGrade('correct')}>
            Got it
          </button>
          <button className="btn btn-missed-it" onClick={() => selfGrade('incorrect')}>
            Missed it
          </button>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="nav-buttons">
        <button
          className="btn btn-nav"
          onClick={navigatePrev}
          disabled={isFirstCard}
          aria-label="Previous card"
        >
          &larr; Previous
        </button>
        <button
          className="btn btn-nav"
          onClick={navigateNext}
          disabled={isLastCard}
          aria-label="Next card"
        >
          Next &rarr;
        </button>
      </div>

      <div className="keyboard-hints">
        <span>&larr; / &rarr; navigate</span>
        <span>Space to flip</span>
      </div>
    </div>
  )
}
