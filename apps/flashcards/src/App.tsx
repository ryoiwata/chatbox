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

export default function App() {
  const [deck, setDeck] = useState<DeckState | null>(null)
  const deckRef = useRef<DeckState | null>(null)
  deckRef.current = deck

  const sendStateUpdate = useCallback((d: DeckState) => {
    window.parent.postMessage({
      type: 'state_update',
      state: {
        topic: d.topic,
        cardCount: d.cards.length,
        currentCard: d.currentCard,
        score: { correct: d.score.correct, total: d.score.total },
        completed: d.completed,
      },
    }, '*')
  }, [])

  const sendCompletion = useCallback((d: DeckState) => {
    const percentage = d.cards.length > 0
      ? Math.round((d.score.correct / d.cards.length) * 100)
      : 0
    window.parent.postMessage({
      type: 'completion',
      result: {
        topic: d.topic,
        correct: d.score.correct,
        total: d.cards.length,
        percentage,
        summary: `Quiz complete: ${d.score.correct}/${d.cards.length} correct (${percentage}%)`,
      },
    }, '*')
  }, [])

  // Send ready + register tools on mount
  useEffect(() => {
    window.parent.postMessage({ type: 'ready' }, '*')
    window.parent.postMessage({ type: 'register_tools', schemas: TOOL_SCHEMAS }, '*')
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
          const updated = { ...current, currentCard: cardIndex, showingBack: showBack, lastResult: null as 'correct' | 'incorrect' | null }
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
          const newResults = [...current.score.results]
          newResults[checkIndex] = correct
          const newScore: Score = {
            correct: newResults.filter(Boolean).length,
            total: newResults.filter((r) => r !== undefined).length,
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
          const pct = current.cards.length > 0
            ? Math.round((current.score.correct / current.cards.length) * 100)
            : 0
          window.parent.postMessage({
            type: 'tool_result',
            toolCallId,
            result: {
              correct: current.score.correct,
              total: current.score.total,
              percentage: pct,
              cards: current.cards.map((c, i) => ({
                front: c.front,
                correct: current.score.results[i] ?? null,
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

  // Render
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
  const answeredCount = deck.score.total
  const totalCards = deck.cards.length

  if (deck.completed) {
    const pct = totalCards > 0 ? Math.round((deck.score.correct / totalCards) * 100) : 0
    return (
      <div className="flashcard-container" style={{ position: 'relative' }}>
        <div className="title">Flashcard Quiz</div>
        <div className="topic-badge">{deck.topic}</div>
        <div className="percentage-big">{pct}%</div>
        <div style={{ fontSize: '14px', color: '#888', marginBottom: '8px' }}>
          {deck.score.correct} of {totalCards} correct
        </div>
        <div className="summary-card">
          <h3>Results</h3>
          {deck.cards.map((c, i) => (
            <div className="summary-row" key={i}>
              <span style={{ flex: 1 }}>{c.front}</span>
              <span className={deck.score.results[i] ? 'summary-icon-correct' : 'summary-icon-incorrect'}>
                {deck.score.results[i] ? 'O' : 'X'}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flashcard-container" style={{ position: 'relative' }}>
      <div className="score-tracker">
        <span className="correct">{deck.score.correct}</span>
        <span className="total">/{answeredCount} correct</span>
      </div>

      <div className="title">Flashcard Quiz</div>
      <div className="topic-badge">{deck.topic}</div>
      <div className="card-progress">
        Card {deck.currentCard + 1} of {totalCards}
      </div>

      {currentCard && (
        <div className="card-scene">
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
    </div>
  )
}
