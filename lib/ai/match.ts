import Anthropic from '@anthropic-ai/sdk'
import { VALID_GROUPS, buildMatchEmployeePrompt, buildSuggestGroupPrompt } from './prompts'
import type { ValidGroup } from './prompts'

const MODEL = 'claude-sonnet-4-20250514'
const anthropic = new Anthropic()

export type MatchResult = {
  candidateName: string
  score: number
  reasoning: string
}

export type GroupSuggestion = {
  suggestedGroup: string
  confidence: number
  reasoning: string
}

const FALLBACK_SUGGESTION: GroupSuggestion = {
  suggestedGroup: 'Other',
  confidence: 0.1,
  reasoning: 'AI returned invalid group, defaulted to Other',
}

function isMatchResult(val: unknown): val is MatchResult {
  if (typeof val !== 'object' || val === null) return false
  const v = val as Record<string, unknown>
  return (
    typeof v['candidateName'] === 'string' &&
    typeof v['score'] === 'number' &&
    typeof v['reasoning'] === 'string'
  )
}

function stripFences(text: string): string {
  return text.replace(/```json|```/g, '').trim()
}

export async function matchEmployeeName(
  rawName: string,
  existingEmployees: Array<{ displayName: string; knownRawNames: string[] }>
): Promise<MatchResult[]> {
  try {
    const prompt = buildMatchEmployeePrompt(rawName, existingEmployees)

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = message.content[0]
    if (block.type !== 'text') return []

    const cleaned = stripFences(block.text)
    const parsed: unknown = JSON.parse(cleaned)

    if (!Array.isArray(parsed)) return []

    const results = parsed.filter(isMatchResult)
    return results
  } catch (err) {
    console.error('[AI] matchEmployeeName failed:', err)
    return []
  }
}

export async function suggestPayrollItemGroup(
  itemName: string,
  existingItems: Array<{ name: string; groupName: string }>
): Promise<GroupSuggestion> {
  try {
    const prompt = buildSuggestGroupPrompt(itemName, existingItems)

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = message.content[0]
    if (block.type !== 'text') return FALLBACK_SUGGESTION

    const cleaned = stripFences(block.text)
    const parsed: unknown = JSON.parse(cleaned)

    if (typeof parsed !== 'object' || parsed === null) return FALLBACK_SUGGESTION

    const result = parsed as Record<string, unknown>
    const suggestedGroup = result['suggestedGroup']
    const confidence = result['confidence']
    const reasoning = result['reasoning']

    if (
      typeof suggestedGroup !== 'string' ||
      typeof confidence !== 'number' ||
      typeof reasoning !== 'string'
    ) {
      return FALLBACK_SUGGESTION
    }

    if (!(VALID_GROUPS as readonly string[]).includes(suggestedGroup)) {
      return FALLBACK_SUGGESTION
    }

    return {
      suggestedGroup: suggestedGroup as ValidGroup,
      confidence,
      reasoning,
    }
  } catch (err) {
    console.error('[AI] suggestPayrollItemGroup failed:', err)
    return FALLBACK_SUGGESTION
  }
}
