import contributors from './contributors.json'

export interface Contributor {
  name: string
  avatar: string
}

export interface CoreTeam {
  avatar: string
  name: string
  github: string
  twitter?: string
  bluesky?: string
  sponsors?: boolean
  description: string
  packages?: string[]
  functions?: string[]
}

const contributorsAvatars: Record<string, string> = {}

function getAvatarUrl(name: string) {
  return `https://avatars.githubusercontent.com/${name}?v=4`
}

const contributorList = (Object.keys(contributors) as string[]).reduce((acc, name) => {
  contributorsAvatars[name] = getAvatarUrl(name)

  if (contributors[name]) {
    acc.push({ name, avatar: contributorsAvatars[name] })
  }

  return acc
}, [] as Contributor[])

const coreTeamMembers: CoreTeam[] = [
  {
    avatar: contributorsAvatars.chrisbbreuer || 'default-avatar.png',
    name: 'Chris Breuer',
    github: 'chrisbbreuer',
    twitter: 'chrisbbreuer',
    bluesky: 'chrisbreuer.dev',
    sponsors: true,
    description: 'Open sourceror.<br>Core Stacks team.<br>Working at Stacks.js',
    packages: ['core'],
    functions: ['cloud', 'backend', 'frontend', 'ci/cd'],
  },
  {
    avatar: contributorsAvatars.glennmichael123 || 'default-avatar.png',
    name: 'Glenn',
    github: 'glennmichael123',
    twitter: 'glennmichael123',
    sponsors: false,
    packages: ['core'],
    functions: ['backend', 'frontend', 'desktop'],
    description: 'Open sourceror.<br>Core Stacks team.<br>Working at Stacks.js',
  },

  {
    avatar: contributorsAvatars['cab-mikee'] || 'default-avatar.png',
    name: 'Mike',
    github: 'cab-mikee',
    twitter: 'cab-mikee',
    sponsors: false,
    description: 'Open sourceror.<br>Core Stacks team.<br>Working at Stacks.js',
    packages: ['core'],
    functions: ['backend', 'frontend'],
  },

  {
    avatar: contributorsAvatars.konkonam || 'default-avatar.png',
    name: 'Zoltan',
    github: 'konkonam',
    sponsors: true,
    description: 'Open sourceror.<br>Core Stacks team.',
    packages: ['core'],
    functions: ['backend', 'frontend', 'desktop'],
  },
]
  .sort((pre, cur) => {
    const contribute = Object.keys(contributors)
    return contribute.findIndex(name => name === pre.github) - contribute.findIndex(name => name === cur.github)
  })

export { contributorList as contributors, coreTeamMembers }
