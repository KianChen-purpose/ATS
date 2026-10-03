// PATS hosted demo environment, Azure Canada Central (ARCHITECTURE.md §5.1).
// Synthetic data only: the app runs with PATS_ENV=demo (demo sign-in, no live Microsoft 365).
//
// Deployed by .github/workflows/deploy-demo.yml in two passes: first the shared resources
// (deployApps=false), then — once the image is in the registry — the web app and the worker.

targetScope = 'resourceGroup'

@description('Azure region. Keep it in Canada.')
@allowed(['canadacentral', 'canadaeast'])
param location string = 'canadacentral'

@description('Short prefix for resource names (lowercase letters and digits).')
@minLength(3)
@maxLength(12)
param prefix string = 'patsdemo'

@description('Deploy the container apps (needs the image to exist in the registry).')
param deployApps bool = false

@description('Image tag to run (the git commit).')
param imageTag string = 'latest'

@description('Postgres administrator password.')
@secure()
param postgresPassword string

@description('Session signing secret, at least 32 characters.')
@secure()
param sessionSecret string

var suffix = uniqueString(resourceGroup().id)
var tags = { app: 'pats', environment: 'demo', data: 'synthetic-only' }

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: '${prefix}acr${suffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-pull'
  location: location
  tags: tags
}

// AcrPull for the apps' identity.
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, pullIdentity.id, 'acrpull')
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: '${prefix}-pg-${suffix}'
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: 'patsadmin'
    administratorLoginPassword: postgresPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: postgres
  name: 'pats'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Demo only: lets Azure services (the container apps) reach the server. Use private networking for production.
resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource appsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}

var webName = '${prefix}-web'
var appUrl = 'https://${webName}.${appsEnv.properties.defaultDomain}'
var image = '${registry.properties.loginServer}/pats:${imageTag}'
var databaseUrl = 'postgres://patsadmin:${uriComponent(postgresPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/pats?sslmode=require'
var secrets = [
  { name: 'database-url', value: databaseUrl }
  { name: 'session-secret', value: sessionSecret }
]
var sharedEnv = [
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'SESSION_SECRET', secretRef: 'session-secret' }
  { name: 'PATS_ENV', value: 'demo' }
  { name: 'PATS_DEMO_AUTH', value: 'true' }
  { name: 'APP_URL', value: appUrl }
]

resource web 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: webName
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${pullIdentity.id}': {} } }
  properties: {
    managedEnvironmentId: appsEnv.id
    configuration: {
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      registries: [{ server: registry.properties.loginServer, identity: pullIdentity.id }]
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'web'
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: sharedEnv
          probes: [
            { type: 'Startup', httpGet: { path: '/login', port: 3000 }, initialDelaySeconds: 10, periodSeconds: 10, failureThreshold: 30 }
          ]
        }
      ]
      // One replica always on, so the demo never cold-starts in front of people.
      scale: { minReplicas: 1, maxReplicas: 2 }
    }
  }
  dependsOn: [acrPull, database, allowAzure]
}

resource worker 'Microsoft.App/containerApps@2024-03-01' = if (deployApps) {
  name: '${prefix}-worker'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${pullIdentity.id}': {} } }
  properties: {
    managedEnvironmentId: appsEnv.id
    configuration: {
      registries: [{ server: registry.properties.loginServer, identity: pullIdentity.id }]
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: image
          command: ['pats-entrypoint']
          args: ['npm', 'run', 'worker']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          // The web app applies migrations and the demo seed; the worker only runs jobs.
          env: concat(sharedEnv, [{ name: 'RUN_MIGRATIONS', value: 'false' }, { name: 'DEMO_SEED_ON_EMPTY', value: 'false' }])
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [web]
}

output registryName string = registry.name
output appUrl string = appUrl
