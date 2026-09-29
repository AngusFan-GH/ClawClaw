'use strict'

const DSH_ALPHA_VERSION = '0.1.6-alpha.2'
const DSH_STABLE_VERSION = '0.1.5-rc.2'
const DSH_PACKAGE_PREFIX = '@deepseek-ai/dsh'
const TYPE_DEPENDENCY_PREFIXES = [
  '@deepseek-ai/dsh-api-',
]
const TYPE_DEPENDENCIES = new Set([
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-typert-protocol',
  'simple-icons',
])

function isSharedTypeDependency(name) {
  return TYPE_DEPENDENCIES.has(name)
    || TYPE_DEPENDENCY_PREFIXES.some(prefix => name.startsWith(prefix))
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (!pkg.name?.startsWith(DSH_PACKAGE_PREFIX)
        || (pkg.version !== DSH_STABLE_VERSION && pkg.version !== DSH_ALPHA_VERSION)) {
        return pkg
      }
      const dependencies = { ...pkg.dependencies }
      if (pkg.version === DSH_ALPHA_VERSION) {
        for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
          if (isSharedTypeDependency(name)) dependencies[name] ??= version
        }
      }
      for (const name of Object.keys(dependencies)) {
        if (name.startsWith(DSH_PACKAGE_PREFIX)) dependencies[name] = pkg.version
      }
      return { ...pkg, dependencies }
    },
  },
}
