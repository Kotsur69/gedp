# GEDP 2027

Web tool for the annual employee goals & development process: group goals,
performance goals, development goals, validation by the direct manager (N+1),
visibility for higher-level managers, HR oversight and an HR panel with reports.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Planned: PostgreSQL + Prisma, Auth.js (Entra ID / LDAP adapter), next-intl (PL/EN)
- Preview hosting: Vercel

## Development

```bash
npm ci
npm run dev     # http://localhost:3000
npm run lint
npm run build
```

## Status

Early stage — version 0.1 (requirements + project skeleton). Every push to
`main` deploys to Vercel production; pull requests get preview deployments.
