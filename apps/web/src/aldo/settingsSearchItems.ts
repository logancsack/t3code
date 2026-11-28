import type { SettingsSearchItem } from "../components/settings/settingsSearch";

/** Aldo's own settings pages, by the name its nav and search show. */
export const ALDO_SETTINGS_SECTION_LABELS = {
  "/settings/account": "Account & billing",
  "/settings/organization": "Organization",
  "/settings/members": "Members",
  "/settings/running": "Running now",
  "/settings/activity": "Activity",
  "/settings/joining": "Who can join",
  "/settings/agents": "Models",
  "/settings/permissions": "Permissions",
  "/settings/notifications": "Notifications & phone",
  "/settings/phone": "Notifications & phone",
  "/settings/code": "Code",
  "/settings/instructions": "About you",
  "/settings/skills": "About you",
  "/settings/memory": "About you",
  "/settings/vault": "Vault",
  "/settings/shared": "Library",
  "/settings/environments": "Code",
} as const;

export type AldoSettingsPath = keyof typeof ALDO_SETTINGS_SECTION_LABELS;

/** Search results for Aldo's pages and rows; shown only in Aldo cloud mode. */
export const ALDO_SETTINGS_SEARCH_ITEMS = [
  // Account & billing
  {
    id: "aldo-account",
    title: "Profile, password and security",
    description: "Name, email, password, two-step verification, devices and deleting your account",
    to: "/settings/account",
    searchTerms: [
      "profile name email picture password two-step 2fa security devices manage delete account close",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-plan",
    title: "Plan and billing",
    description: "Your current plan, included credits, invoices and payment card",
    to: "/settings/account",
    searchTerms: [
      "subscription upgrade downgrade cancel credits billing invoices receipts payment method card money",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-extra-usage-cap",
    title: "Monthly extra usage cap",
    description: "Maximum extra Aldo credits you can spend past your included plan each month",
    to: "/settings/account",
    targetId: "aldo-extra-usage-cap",
    searchTerms: [
      "spending limit budget cap extra usage overage credits monthly dollars cost billing",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-subscription-limits",
    title: "AI subscription quotas",
    description: "Remaining usage and reset times for your connected Claude, ChatGPT or Grok plans",
    to: "/settings/account",
    searchTerms: ["claude codex chatgpt grok weekly limit resets usage left quota rate"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-computers",
    title: "Windows and GPU computers",
    description: "Hourly rates, active status and controls for Windows and GPU computers",
    to: "/settings/account",
    targetId: "aldo-computers",
    searchTerms: [
      "windows gpu computer machine vm excel word powerpoint office credits hourly stop active",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-sign-out",
    title: "Sign out",
    description: "Sign out of Aldo on this device",
    to: "/settings/account",
    searchTerms: ["log out leave this device session"],
    aldoCloudOnly: true,
  },

  // Models
  {
    id: "aldo-subscriptions",
    title: "AI subscriptions and API keys",
    description: "Connect Claude, ChatGPT, Grok, Muse Code, Google Antigravity or OpenCode",
    to: "/settings/agents",
    searchTerms: [
      "models claude chatgpt codex grok muse google antigravity opencode api key openrouter anthropic openai gemini subscription",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-provider-limit",
    title: "When a subscription runs out mid-task",
    description: "Switch automatically to another model or wait for the quota to reset",
    to: "/settings/agents",
    searchTerms: ["usage limit reached mid-task wait reset switch model recovery automatic"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-paid-fallback",
    title: "Go past your plans’ limits",
    description: "Use extra Aldo credits when your AI subscriptions run out",
    to: "/settings/agents",
    searchTerms: [
      "pay extra usage credits paid fallback model routing overflow budget spend limit",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-paid-connected-models",
    title: "Allow paid models in Automatic",
    description: "Let Automatic routing use paid API-key models you connected",
    to: "/settings/agents",
    searchTerms: ["paid model automatic routing fallback opencode api key cost spend"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-context-budget",
    title: "Conversation length",
    description: "How long a thread runs before Aldo summarizes earlier context",
    to: "/settings/agents",
    searchTerms: ["long conversations context budget compact compaction tokens summarize"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-subagents",
    title: "Helper models",
    description: "Default model and reasoning effort used by background helper agents",
    to: "/settings/agents",
    searchTerms: ["subagents helpers model reasoning effort claude code codex"],
    aldoCloudOnly: true,
  },

  // Permissions
  {
    id: "aldo-spend-threshold",
    title: "Purchase approval limit",
    description: "Maximum an agent can spend on a purchase without asking you first",
    to: "/settings/permissions",
    searchTerms: [
      "spending limit money spend without asking threshold dollars purchase buy approve budget safety net",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-accounts",
    title: "Sign up for sites",
    description: "Whether agents can create free accounts or profiles in your name",
    to: "/settings/permissions",
    searchTerms: [
      "accounts in your name sign up signup register create account profile listing terms login vault ask me first never",
    ],
    aldoCloudOnly: true,
    requiresAldoPolicyRule: "accounts",
  },
  {
    id: "aldo-publishing",
    title: "Publish",
    description: "Whether agents can publish posts, pages or listings after checking them",
    to: "/settings/permissions",
    searchTerms: ["publishing for you post listing page go live public show me first"],
    aldoCloudOnly: true,
    requiresAldoPolicyRule: "publishing",
  },
  {
    id: "aldo-media-routing",
    title: "Media tools and defaults",
    description: "How agents pick image, video, audio and 3D tools and your saved defaults",
    to: "/settings/permissions",
    searchTerms: [
      "image video audio 3d media generation choose ask default tool tools you always use",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-always-allowed",
    title: "Always allowed",
    description: "Actions you’ve approved to run without asking again",
    to: "/settings/permissions",
    searchTerms: ["approval rules always allow without asking remove permissions"],
    aldoCloudOnly: true,
  },

  // About you
  {
    id: "aldo-memory",
    title: "Memory",
    description: "Facts your agents remember about you across threads",
    to: "/settings/memory",
    searchTerms: ["memory remembered facts what agents know about me notes forget about you"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-instructions",
    title: "Instructions",
    description: "Standing rules and preferences every agent reads before starting",
    to: "/settings/instructions",
    searchTerms: [
      "instructions every project agents read preferences conventions how I like things done remember rules personalization about you",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-skills",
    title: "Skills",
    description: "Saved step-by-step playbooks for recurring types of work",
    to: "/settings/skills",
    searchTerms: [
      "skills playbooks how agents do a task steps feedback do avoid teach save_skill skill.md new edit remove",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-interests",
    title: "Your work focus",
    description: "Topics that shape starter ideas on Home",
    to: "/settings/instructions",
    searchTerms: [
      "interests what you hand aldo welcome starters ideas home work focus business finance documents media research code",
    ],
    aldoCloudOnly: true,
    requiresAldoOnboarding: true,
  },

  // Notifications & phone
  {
    id: "aldo-quiet-hours",
    title: "Quiet hours",
    description: "Pause non-urgent push alerts and heads-ups overnight",
    to: "/settings/notifications",
    searchTerms: [
      "night sleep do not disturb dnd mute hold wait heads-ups finished threads push start end time",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-notifications",
    title: "Push notifications on this device",
    description: "Browser and phone push alerts when a thread finishes or needs you",
    to: "/settings/notifications",
    searchTerms: ["push alerts notify phone browser finished needs you notifications"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-notification-sound",
    title: "Play a chime",
    description: "Soft sound in open tabs when a thread finishes or needs you",
    to: "/settings/notifications",
    searchTerms: ["notifications chime sound audio alert ding"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-phone",
    title: "Text and call Aldo",
    description: "Verify your phone number to text or call Aldo by SMS and voice",
    to: "/settings/notifications",
    targetId: "aldo-phone",
    searchTerms: ["phone sms mms voice call text number verification pin disconnect"],
    aldoCloudOnly: true,
    requiresAldoPhone: true,
  },
  {
    id: "aldo-fallback-emails",
    title: "Fallback emails",
    description:
      "Emails sent if push alerts are off and a finished thread or approval waits 5 minutes",
    to: "/settings/notifications",
    targetId: "aldo-fallback-emails",
    searchTerms: ["email notifications fallback unseen approvals finished threads"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-brief",
    title: "Daily brief",
    description: "Morning summary of what needs you and what’s scheduled today",
    to: "/settings/notifications",
    searchTerms: ["morning brief time push notification what needs you today off digest"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-heads-ups",
    title: "Heads-ups from Aldo",
    description: "Proactive alerts from your mail, calendar and connected apps",
    to: "/settings/notifications",
    searchTerms: [
      "mail calendar events half hour what's worth knowing other apps tell me about skip don't tell me",
    ],
    aldoCloudOnly: true,
  },

  // Connections
  {
    id: "aldo-agent-inbox",
    title: "Your agents’ email",
    description: "Claim a dedicated email address your agents can send and receive from",
    to: "/settings/connections",
    searchTerms: [
      "agent inbox email address mail handle claim agentmail aldomail sender name display name from rename",
    ],
    aldoCloudOnly: true,
    requiresAldoAgentInbox: true,
  },
  {
    id: "aldo-integration-google",
    title: "Google",
    description: "Connect Gmail, Calendar, Drive, Docs, Sheets and Contacts",
    to: "/settings/connections",
    searchTerms: [
      "integrations accounts connect disconnect gmail mail calendar contacts drive docs sheets",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-integration-microsoft",
    title: "Microsoft",
    description: "Connect Outlook, Calendar, OneDrive, SharePoint and Microsoft 365",
    to: "/settings/connections",
    searchTerms: [
      "integrations accounts connect disconnect outlook onedrive sharepoint excel office 365 work school personal",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-integration-link",
    title: "Link payments",
    description: "Connect a Link wallet so agents can check out after you approve",
    to: "/settings/connections",
    searchTerms: [
      "link wallet stripe payments pay card credit debit buy purchase checkout approve approval spend connect disconnect",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-apps",
    title: "Work apps",
    description: "Connect Notion, Linear, Jira, Canva, Zapier or add a custom app",
    to: "/settings/connections",
    searchTerms: [
      "apps mcp server connectors plugins connect disconnect zapier notion linear jira confluence atlassian airtable canva granola stripe paypal webflow supabase sentry hugging face",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-generators",
    title: "Image, video and audio tools",
    description: "Connect Runway, Luma, Fal, ElevenLabs, Replicate and other media generators",
    to: "/settings/connections",
    searchTerms: [
      "generators media generation ai video image audio voice music speech api key runway higgsfield luma fal replicate elevenlabs flux black forest labs kling minimax hailuo ideogram veo imagen sora gpt image",
    ],
    aldoCloudOnly: true,
  },

  // Vault
  {
    id: "aldo-vault",
    title: "Vault: logins and API keys",
    description: "Website logins and API keys your agents use without ever reading back",
    to: "/settings/vault",
    searchTerms: [
      "vault secrets api keys tokens passwords logins saved credentials environment variables files",
    ],
    aldoCloudOnly: true,
  },

  // Preferences
  {
    id: "aldo-appearance",
    title: "Theme",
    description: "Light, dark or match this device",
    to: "/settings/general",
    targetId: "aldo-appearance",
    searchTerms: ["appearance color scheme light dark system mode night theme"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-simple-mode",
    title: "View (Simple or Full)",
    description: "Simple view shows Aldo, Needs you and Library; Full view adds the thread sidebar",
    to: "/settings/general",
    targetId: "aldo-simple-mode",
    searchTerms: [
      "layout simple mode rail sidebar hide threads just aldo needs you library full view",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-text-size",
    title: "Text size",
    description: "Adjust interface text between small, default and large",
    to: "/settings/general",
    targetId: "aldo-text-size",
    searchTerms: ["font size typography bigger smaller readable zoom scale"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-contrast",
    title: "Higher contrast",
    description: "Increase border and text contrast across the app",
    to: "/settings/general",
    targetId: "aldo-contrast",
    searchTerms: ["contrast borders accessibility readability visual"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-preload",
    title: "Keep agents ready",
    description: "Start or wake an agent’s computer ahead of time so threads open faster",
    to: "/settings/general",
    searchTerms: ["speed preload have agents ready start computer wake open thread faster waiting"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-developer-tools",
    title: "Developer tools",
    description: "Show Code settings, pull requests, terminal and diffs",
    to: "/settings/general",
    targetId: "aldo-developer-tools",
    searchTerms: [
      "developer mode code tools pull requests terminal diff git environments show hide",
    ],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-reset-device",
    title: "Reset this device’s settings",
    description: "Restore theme, view, chime and device preferences to default",
    to: "/settings/general",
    targetId: "aldo-reset-device",
    searchTerms: ["restore reset defaults clear device preferences local"],
    aldoCloudOnly: true,
  },

  // Code (shown only when Developer tools is on)
  {
    id: "aldo-merge",
    title: "Auto-merge pull requests",
    description: "Whether Aldo merges pull requests automatically after checks pass",
    to: "/settings/code",
    searchTerms: ["auto merge approve checks pass pull request pr"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-merge-method",
    title: "Merge method",
    description: "Squash, merge commit or rebase per repository",
    to: "/settings/code",
    searchTerms: ["squash rebase merge commit repository pull request"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-reviews",
    title: "Automated reviews",
    description: "How agents handle comments from automated code reviewers",
    to: "/settings/code",
    searchTerms: ["codex reviewer findings comments fix pull request"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-environments",
    title: "Ready-to-go environments",
    description: "Prebuilt dependencies and dev services so coding threads start fast",
    to: "/settings/code",
    searchTerms: [
      "environments ready-to-go setup install build workspace computer prebuilt dependencies",
    ],
    aldoCloudOnly: true,
  },

  // Routines & Voice
  {
    id: "aldo-routines",
    title: "Routines",
    description: "Scheduled work and webhooks Aldo runs automatically",
    to: "/settings/scheduled-tasks",
    searchTerms: ["routines schedule cron daily weekly recurring webhook automations tasks"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-voice",
    title: "Voice input",
    description: "Microphone and dictation settings on this device",
    to: "/settings/voice",
    searchTerms: ["voice dictation microphone speech mic transcribe"],
    aldoCloudOnly: true,
  },
  {
    id: "aldo-shared",
    title: "Library and shared files",
    description: "Pages and files your agents shared by link",
    to: "/settings/shared",
    searchTerms: [
      "library shared files pages links public only me stop sharing unshare what agents made share_file",
    ],
    aldoCloudOnly: true,
  },

  // Organization (shown only for org members)
  {
    id: "aldo-organization",
    title: "Organization",
    description: "Your organization’s name, owners, seats and billing",
    to: "/settings/organization",
    searchTerms: ["organization org company name rename seats owners leave delete"],
    aldoCloudOnly: true,
    requiresAldoOrganization: true,
  },
  {
    id: "aldo-members",
    title: "Members",
    description: "People in your organization, roles, invites and credit caps",
    to: "/settings/members",
    searchTerms: [
      "members people team invite invites roles owner admin member remove step down resend revoke link credits usage limit pause",
    ],
    aldoCloudOnly: true,
    requiresAldoOrganization: true,
  },
  {
    id: "aldo-running",
    title: "Running now",
    description: "Every machine running in your organization’s threads",
    to: "/settings/running",
    searchTerms: ["running now active machines computers threads org cost priciest"],
    aldoCloudOnly: true,
    requiresAldoOrganization: true,
  },
  {
    id: "aldo-joining",
    title: "Who can join",
    description: "Verified domains, default roles and organization invite links",
    to: "/settings/joining",
    searchTerms: [
      "who can join domain domains verify dns txt record invite link share link requests ask join right away invite only",
    ],
    aldoCloudOnly: true,
    requiresAldoJoining: true,
  },
  {
    id: "aldo-activity",
    title: "Activity",
    description: "Audit log of organization changes and admin actions",
    to: "/settings/activity",
    searchTerms: ["activity log history audit who changed stopped paused invited removed"],
    aldoCloudOnly: true,
    requiresAldoOrganization: true,
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
