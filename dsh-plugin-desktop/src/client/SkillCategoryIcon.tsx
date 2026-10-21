// @ts-expect-error package subpath has no declaration file
import ChartNoAxesCombined from 'lucide-react/dist/esm/icons/chart-no-axes-combined.mjs'
// @ts-expect-error package subpath has no declaration file
import FileText from 'lucide-react/dist/esm/icons/file-text.mjs'
// @ts-expect-error package subpath has no declaration file
import PenLine from 'lucide-react/dist/esm/icons/pen-line.mjs'
// @ts-expect-error package subpath has no declaration file
import BriefcaseBusiness from 'lucide-react/dist/esm/icons/briefcase-business.mjs'
// @ts-expect-error package subpath has no declaration file
import BookOpen from 'lucide-react/dist/esm/icons/book-open.mjs'
// @ts-expect-error package subpath has no declaration file
import CodeXml from 'lucide-react/dist/esm/icons/code-xml.mjs'
// @ts-expect-error package subpath has no declaration file
import Wallet from 'lucide-react/dist/esm/icons/wallet.mjs'
// @ts-expect-error package subpath has no declaration file
import Palette from 'lucide-react/dist/esm/icons/palette.mjs'
// @ts-expect-error package subpath has no declaration file
import Puzzle from 'lucide-react/dist/esm/icons/puzzle.mjs'
// @ts-expect-error package subpath has no declaration file
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.mjs'
import type { SkillCategory } from './skill-presentation.ts'

const ICONS = { all: Puzzle, productivity: Puzzle, content: PenLine, data: ChartNoAxesCombined, business: BriefcaseBusiness, office: FileText, learning: BookOpen, development: CodeXml, finance: Wallet, design: Palette, compliance: ShieldCheck }

export function SkillCategoryIcon({ category }: { category: SkillCategory }) {
  const Icon = ICONS[category]
  return <span className="dshSkillsCategoryIcon" data-category={category} aria-hidden="true"><Icon /></span>
}
