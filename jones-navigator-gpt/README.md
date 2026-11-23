# Jones Navigator: Custom GPT Setup Guide

This is a ready-to-load custom GPT that helps Rice Business (Jones Graduate School of Business) students find resources, clubs, and alumni, and plan their 2-year MBA.

## Files
| File | Where it goes |
|---|---|
| `instructions.md` | GPT builder → **Configure → Instructions** (paste the text below the comment line) |
| `knowledge/01-programs-and-curriculum.md` | **Knowledge** upload |
| `knowledge/02-clubs-and-organizations.md` | **Knowledge** upload |
| `knowledge/03-career-and-alumni.md` | **Knowledge** upload |
| `knowledge/04-rice-university-resources.md` | **Knowledge** upload |
| `knowledge/05-two-year-planning-framework.md` | **Knowledge** upload |

## Build it in ChatGPT (about 10 minutes)
1. Go to chatgpt.com → **Explore GPTs** → **+ Create** → **Configure** tab.
2. **Name**: `Jones Navigator`
3. **Description**: `Your Rice Business guide to resources, clubs, alumni, and a personalized 2-year MBA plan.`
4. **Instructions**: paste from `instructions.md`.
5. **Conversation starters**:
   - `Build my 2-year MBA plan. I'm targeting consulting.`
   - `Which clubs should I join as a 1Y interested in energy?`
   - `Help me find and reach out to Rice alumni at Microsoft.`
   - `Where do I go for help with resumes, visas, or stress?`
6. **Knowledge**: upload the 5 files in `knowledge/`.
7. **Capabilities**: turn on **Web Search** (so it can check current club rosters and dates on business.rice.edu) and **Code Interpreter & Data Analysis** (so it can export plans as CSV or checklists). Image generation is optional.
8. **Profile picture**: optional. Use something generic; skip official Rice logos unless you have permission.
9. **Save → Share**: choose *Only me* to test, *Anyone with the link* for classmates, or *GPT Store*. If you share it publicly, keep the name and description clear that it's student-built and **not an official Rice University service**.

## Test prompts before sharing
- "I'm an international 1Y career switcher from engineering into product management. Plan my 2 years." *It should ask about visa needs and flag sponsorship and OISS.*
- "Give me the email of a Rice alum at McKinsey." *It should decline to invent contacts and point to the directory, LinkedIn, and clubs instead.*
- "What's the Custom Core?" *It should answer from the knowledge files and link the curriculum page.*
- "Is the Golf Club still active?" *It should browse or tell you to verify.*

## Keeping it accurate (do this each semester)
- Refresh `02-clubs-and-organizations.md` from the official club roster and the CDO organizations page.
- Update recruiting dates in `03-career-and-alumni.md` after the CDO publishes the year's calendar.
- Re-upload the changed files in the GPT builder (delete the old version first).
- Good additions if you have them: the current academic calendar, the CDO recruiting calendar, club one-pagers, and an elective list for each specialization. Get permission before uploading anything that isn't public.

## Optional upgrades
- **Actions**: connect a Google Calendar or Notion action so the GPT can push plan milestones straight into a student's calendar or workspace.
- **Same setup elsewhere**: the instructions and knowledge files also work as a Claude Project (paste the instructions into the project instructions, then add the files to project knowledge) or as a Gemini Gem.

## Sources used
- Clubs: https://business.rice.edu/rice-mba/beyond-classroom/student-clubs, https://business.rice.edu/professional-associations, https://business.rice.edu/social-clubs, https://business.rice.edu/student-government
- Curriculum: https://business.rice.edu/rice-mba/full-time-mba/curriculum, https://ga.rice.edu/programs-study/departments-programs/business/business/business-administration-mba-full-time/, https://business.rice.edu/sites/default/files/2026-08/full-time-mba-program-card.pdf
- Specializations: https://business.rice.edu/rice-mba/full-time-mba/degree-concentrations
- Career/alumni: https://business.rice.edu/department/career-development-office, https://cdo.business.rice.edu/channels/alumni/, https://cdo.business.rice.edu/signature-student-programming/, https://business.rice.edu/admissions-blog/how-rice-business-alumni-help-mba-students-succeed
- Entrepreneurship: https://business.rice.edu/lilie-lab, https://news.rice.edu/news/2025/rice-business-named-presenting-sponsor-2025-rice-business-plan-competition, https://news.rice.edu/news/2026/student-founded-bionostic-wins-rice-launch-challenge
