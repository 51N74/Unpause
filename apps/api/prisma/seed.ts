import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';

dotenv.config();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run seed script in production environment.');
  process.exit(1);
}

import { ensureLocalPostgresIfNeeded } from '../src/lib/devPostgres.js';

const prisma = new PrismaClient();

let stopLocalPg: (() => Promise<void>) | null = null;

async function main() {
  stopLocalPg = await ensureLocalPostgresIfNeeded();
  console.log('Running development seed...');

  const email = 'demo@unpause.local';
  const passwordHash = await hashPassword('Password123!');

  // Clean existing demo user data if re-running seed
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const existingProjects = await prisma.project.findMany({
      where: { userId: existingUser.id },
      select: { id: true },
    });
    const projectIds = existingProjects.map((p) => p.id);
    if (projectIds.length > 0) {
      await prisma.decisionRecord.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.issue.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.scopeVersion.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.project.deleteMany({
        where: { id: { in: projectIds } },
      });
    }
    await prisma.user.delete({ where: { id: existingUser.id } });
  }

  const demoUser = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: 'Alex (Solo Dev)',
    },
  });

  const project = await prisma.project.create({
    data: {
      userId: demoUser.id,
      name: 'InvoiceFlow CLI',
      description:
        'A lightweight command-line invoice generator for freelance developers.',
      status: 'Active',
    },
  });

  const scopeV1 = await prisma.scopeVersion.create({
    data: {
      projectId: project.id,
      versionNumber: 1,
      problem:
        'Freelancers waste 30 minutes formatting PDF invoices manually every month.',
      targetUsers: 'Solo freelance software engineers billing 1-5 clients.',
      goal: 'Generate clean PDF invoices from a YAML file in under 10 seconds.',
      inScope:
        'YAML config parsing, single HTML-to-PDF template, CLI flags for output path, tax calculation.',
      outOfScope:
        'Web dashboard, recurring billing automation, Stripe integration, multi-user accounts.',
      reasonForChange: 'Initial scope',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    },
  });

  const issue1 = await prisma.issue.create({
    data: {
      projectId: project.id,
      title: 'Fix rounding error on fractional tax rates',
      description: 'Tax rates like 7.25% produce floating point precision issues.',
      status: 'InProgress',
      priority: 'High',
      nextAction: 'Replace float multiplication with integer cents arithmetic in src/calc.ts',
    },
  });

  const issue2 = await prisma.issue.create({
    data: {
      projectId: project.id,
      title: 'Add currency symbol option to YAML schema',
      description: 'Support USD, THB, and EUR symbols in invoice totals.',
      status: 'Open',
      priority: 'Medium',
      nextAction: 'Add currency enum to Zod config schema and update PDF footer partial',
    },
  });

  await prisma.decisionRecord.create({
    data: {
      projectId: project.id,
      scopeVersionId: scopeV1.id,
      issueId: issue1.id,
      problem: 'Need reliable PDF generation without requiring headless Chrome.',
      decision: 'Use PDFKit directly instead of Puppeteer.',
      rationale:
        'Puppeteer downloads a 150MB Chromium binary and breaks offline CLI installs.',
      alternativesConsidered: 'Puppeteer, Playwright, wkhtmltopdf',
      outcome: 'CLI package size dropped to 4MB and installs in 2 seconds.',
      scopeImpact: 'Narrows',
      isPinned: true,
      pinnedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
    },
  });

  const scopeV2 = await prisma.scopeVersion.create({
    data: {
      projectId: project.id,
      versionNumber: 2,
      problem:
        'Freelancers waste 30 minutes formatting PDF invoices manually every month.',
      targetUsers:
        'Solo freelance software engineers billing domestic and international clients.',
      goal: 'Generate clean PDF invoices from a YAML file with multi-currency support.',
      inScope:
        'YAML config parsing, single PDFKit layout, CLI flags, integer tax calculation, static currency symbol formatting.',
      outOfScope:
        'Web dashboard, live FX rate fetching, recurring billing, Stripe integration.',
      reasonForChange:
        'Two early testers needed EUR and THB symbol support on invoices, while HTML-to-PDF was dropped in favor of a single PDFKit layout.',
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.decisionRecord.create({
    data: {
      projectId: project.id,
      scopeVersionId: scopeV2.id,
      issueId: issue2.id,
      problem: 'Users requested multi-currency invoices, which could balloon scope.',
      decision:
        'Support static currency code and symbol in YAML only; do not fetch exchange rates.',
      rationale:
        'Freelancers already agree on a billing currency per contract; live FX APIs add failure modes.',
      alternativesConsidered: 'OpenExchangeRates API integration',
      outcome: 'Kept CLI 100% offline-capable.',
      scopeImpact: 'Expands',
      isPinned: true,
      pinnedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    },
  });

  console.log('Seed completed! Demo login: demo@unpause.local / Password123!');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (stopLocalPg) {
      await stopLocalPg();
    }
  });
