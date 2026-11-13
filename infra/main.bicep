// Vertragsmanagement LLV: Azure infrastructure for the Azure Developer CLI.
//
// Everything runs in Switzerland North (data residency). All access between
// the app and Azure services is passwordless: one user-assigned managed
// identity, RBAC role assignments, local auth disabled where the service
// allows it. No keys or secrets end up in app settings.

targetScope = 'subscription'

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

@minLength(1)
@maxLength(64)
@description('Name of the azd environment, used in resource names and the azd-env-name tag.')
param environmentName string

@description('Region for all resources. Restricted to Switzerland for data residency.')
@allowed([
  'switzerlandnorth'
  'switzerlandwest'
])
@metadata({
  azd: {
    type: 'location'
  }
})
param location string = 'switzerlandnorth'

@description('Optional resource group name. Default: rg-<environmentName>.')
param resourceGroupName string = ''

@description('Object ID of the user or pipeline running azd (set by azd as AZURE_PRINCIPAL_ID). Gets Key Vault Secrets Officer.')
param principalId string = ''

@description('Set by azd: true once the Container App exists, so provision keeps the deployed image.')
param appExists bool = false

// --- Sign-in --------------------------------------------------------------

@allowed([
  'mock'
  'entra'
])
param authMode string = 'mock'
@description('Entra tenant for AUTH_MODE=entra. Empty = tenant of the subscription.')
param entraTenantId string = ''
@description('Application ID URI of the API app registration, e.g. api://vertragsmanagement. Empty = app default.')
param entraApiAudience string = ''
@description('Client ID of the SPA app registration.')
param entraSpaClientId string = ''

@description('Comma-separated CIDR ranges allowed to reach the app (e.g. the LLV egress IPs). Empty = open to the internet.')
param allowedIpRanges string = ''

// --- Document store -------------------------------------------------------

@allowed([
  'local'
  'onedrive'
])
param storageProvider string = 'local'
param onedriveShareUrl string = ''
param onedriveClientId string = ''
@minValue(1)
param storagePollMinutes int = 2

// --- Azure OpenAI ---------------------------------------------------------

@description('Region of the Azure OpenAI account. Empty = same as location. Only change it if the model is not offered in Switzerland North.')
param openAiLocation string = ''
param openAiModelName string = 'gpt-4.1'
param openAiModelVersion string = '2025-04-14'
@description('Deployment name the app calls. Empty = model name.')
param openAiDeploymentName string = ''
@description('Standard = regional processing (stays in the account region). GlobalStandard/DataZoneStandard may process outside Switzerland.')
@allowed([
  'Standard'
  'DataZoneStandard'
  'GlobalStandard'
  'ProvisionedManaged'
])
param openAiSku string = 'Standard'
@description('Capacity in 1,000 tokens per minute.')
param openAiCapacity int = 50
param openAiApiVersion string = '2024-10-21'
@description('Label shown in the UI for where AI processing happens. Empty = derived from the OpenAI region.')
param aiRegionLabel string = ''

// --- Audit archive, Key Vault, scheduler ----------------------------------

@description('Retention of the audit archive (container-level WORM policy, unlocked in the pilot).')
@minValue(1)
@maxValue(146000)
param auditRetentionDays int = 3650

@description('Enable Key Vault purge protection (irreversible; recommended for production).')
param keyVaultPurgeProtection bool = false

@description('Schedule of the daily deadline job (cron, UTC).')
param dailyJobCron string = '0 5 * * *'

@description('CPU cores of the app container (string, e.g. "1.0").')
param containerCpu string = '1.0'
param containerMemory string = '2Gi'

// --- Optional API Management ----------------------------------------------

@description('Deploy API Management (Consumption) in front of the API. Takes effect once the app has been deployed (the OpenAPI import needs the running app).')
param deployApim bool = false
param apimPublisherEmail string = ''
param apimPublisherName string = 'Liechtensteinische Landesverwaltung'

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = {
  'azd-env-name': environmentName
  application: 'vertragsmanagement'
}

var names = {
  resourceGroup: !empty(resourceGroupName) ? resourceGroupName : 'rg-${environmentName}'
  identity: 'id-${resourceToken}'
  logAnalytics: 'log-${resourceToken}'
  applicationInsights: 'appi-${resourceToken}'
  keyVault: 'kv-${resourceToken}'
  registry: 'cr${resourceToken}'
  containerAppsEnvironment: 'cae-${resourceToken}'
  containerApp: 'ca-api-${resourceToken}'
  dailyJob: 'caj-daily-${resourceToken}'
  postgres: 'psql-${resourceToken}'
  storage: 'st${resourceToken}'
  openAi: 'oai-${resourceToken}'
  docIntel: 'di-${resourceToken}'
  communication: 'acs-${resourceToken}'
  email: 'ecs-${resourceToken}'
  eventGrid: 'evgt-${resourceToken}'
  apim: 'apim-${resourceToken}'
}

var effectiveOpenAiLocation = !empty(openAiLocation) ? openAiLocation : location
var regionLabels = {
  switzerlandnorth: 'Azure Schweiz Nord'
  switzerlandwest: 'Azure Schweiz West'
}
var effectiveAiRegionLabel = !empty(aiRegionLabel)
  ? aiRegionLabel
  : (regionLabels[?effectiveOpenAiLocation] ?? 'Azure ${effectiveOpenAiLocation}')

var ipRanges = filter(map(split(allowedIpRanges, ','), r => trim(r)), r => !empty(r))
var ipRangesCidr = map(ipRanges, r => contains(r, '/') ? r : '${r}/32')

var placeholderImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: names.resourceGroup
  location: location
  tags: tags
}

module identity 'modules/identity.bicep' = {
  name: 'identity'
  scope: rg
  params: {
    location: location
    tags: tags
    name: names.identity
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: {
    location: location
    tags: tags
    logAnalyticsName: names.logAnalytics
    applicationInsightsName: names.applicationInsights
    appPrincipalId: identity.outputs.principalId
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  scope: rg
  params: {
    location: location
    tags: tags
    name: names.keyVault
    appPrincipalId: identity.outputs.principalId
    deployerPrincipalId: principalId
    enablePurgeProtection: keyVaultPurgeProtection
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  scope: rg
  params: {
    location: location
    tags: tags
    name: names.registry
    appPrincipalId: identity.outputs.principalId
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  scope: rg
  params: {
    location: location
    tags: tags
    name: names.postgres
    databaseName: 'vertragsmanagement'
    adminPrincipalId: identity.outputs.principalId
    adminPrincipalName: identity.outputs.name
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: {
    location: location
    tags: tags
    name: names.storage
    auditRetentionDays: auditRetentionDays
    appPrincipalId: identity.outputs.principalId
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
  }
}

module openAi 'modules/openai.bicep' = {
  name: 'openai'
  scope: rg
  params: {
    location: effectiveOpenAiLocation
    tags: tags
    name: names.openAi
    deploymentName: !empty(openAiDeploymentName) ? openAiDeploymentName : openAiModelName
    modelName: openAiModelName
    modelVersion: openAiModelVersion
    skuName: openAiSku
    capacity: openAiCapacity
    appPrincipalId: identity.outputs.principalId
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
  }
}

module docIntel 'modules/docintel.bicep' = {
  name: 'docintel'
  scope: rg
  params: {
    location: location
    tags: tags
    name: names.docIntel
    appPrincipalId: identity.outputs.principalId
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
  }
}

module communication 'modules/communication.bicep' = {
  name: 'communication'
  scope: rg
  params: {
    tags: tags
    communicationServiceName: names.communication
    emailServiceName: names.email
    dataLocation: 'Switzerland'
    appPrincipalId: identity.outputs.principalId
  }
}

module eventGrid 'modules/eventgrid.bicep' = {
  name: 'eventgrid'
  scope: rg
  params: {
    location: location
    tags: tags
    name: names.eventGrid
    appPrincipalId: identity.outputs.principalId
  }
}

module containerAppsEnvironment 'modules/container-apps-environment.bicep' = {
  name: 'container-apps-environment'
  scope: rg
  params: {
    location: location
    tags: tags
    name: names.containerAppsEnvironment
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
  }
}

module fetchAppImage 'modules/fetch-container-image.bicep' = {
  name: 'fetch-app-image'
  scope: rg
  params: {
    exists: appExists
    name: names.containerApp
  }
}

// The app's public URL is known before the app exists: <app name>.<environment default domain>.
var appUrl = 'https://${names.containerApp}.${containerAppsEnvironment.outputs.defaultDomain}'
var appImage = fetchAppImage.outputs.?containers[?0].?image ?? placeholderImage

// Environment variables of the app and the daily job. Entries without a value
// are left out, so the app's own defaults apply.
var appSettings = [
  { name: 'PORT', value: '3000' }
  { name: 'PUBLIC_BASE_URL', value: appUrl }
  { name: 'WEB_DIST_DIR', value: '/app/apps/web/dist' }
  { name: 'DATA_DIR', value: '/tmp/data' }
  {
    name: 'DATABASE_URL'
    value: 'postgres://${identity.outputs.name}@${postgres.outputs.fqdn}:5432/${postgres.outputs.databaseName}?sslmode=require'
  }
  { name: 'DATABASE_ENTRA_AUTH', value: 'true' }
  { name: 'AUTH_MODE', value: authMode }
  { name: 'ENTRA_TENANT_ID', value: !empty(entraTenantId) ? entraTenantId : tenant().tenantId }
  { name: 'ENTRA_API_AUDIENCE', value: entraApiAudience }
  { name: 'ENTRA_SPA_CLIENT_ID', value: entraSpaClientId }
  { name: 'AI_PROVIDER', value: 'azure' }
  { name: 'AZURE_OPENAI_ENDPOINT', value: openAi.outputs.endpoint }
  { name: 'AZURE_OPENAI_DEPLOYMENT', value: openAi.outputs.deploymentName }
  { name: 'AZURE_OPENAI_API_VERSION', value: openAiApiVersion }
  { name: 'DOCINTEL_ENDPOINT', value: docIntel.outputs.endpoint }
  { name: 'AI_REGION_LABEL', value: effectiveAiRegionLabel }
  { name: 'STORAGE_PROVIDER', value: storageProvider }
  { name: 'ONEDRIVE_SHARE_URL', value: onedriveShareUrl }
  { name: 'ONEDRIVE_CLIENT_ID', value: onedriveClientId }
  { name: 'KEY_VAULT_URI', value: keyVault.outputs.uri }
  { name: 'STORAGE_POLL_MINUTES', value: string(storagePollMinutes) }
  { name: 'MAIL_PROVIDER', value: 'acs' }
  { name: 'ACS_ENDPOINT', value: communication.outputs.endpoint }
  { name: 'MAIL_SENDER', value: communication.outputs.senderAddress }
  { name: 'EVENTS_PROVIDER', value: 'eventgrid' }
  { name: 'EVENTGRID_ENDPOINT', value: eventGrid.outputs.endpoint }
  { name: 'AUDIT_BLOB_CONTAINER_URL', value: storage.outputs.auditContainerUrl }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: monitoring.outputs.applicationInsightsConnectionString }
  { name: 'SCHEDULER', value: 'external' }
  { name: 'AZURE_CLIENT_ID', value: identity.outputs.clientId }
]
var appEnv = filter(appSettings, s => !empty(s.value))

module containerApp 'modules/container-app.bicep' = {
  name: 'container-app'
  scope: rg
  params: {
    location: location
    tags: tags
    name: names.containerApp
    environmentId: containerAppsEnvironment.outputs.id
    identityId: identity.outputs.id
    registryServer: registry.outputs.loginServer
    // Using the registry module's output also waits for its AcrPull assignment.
    image: appImage
    env: appEnv
    allowedIpRanges: ipRangesCidr
    cpu: containerCpu
    memory: containerMemory
  }
}

// azd deploy only updates the app; the postdeploy hook (infra/hooks) moves the
// job to the same image, and every provision aligns it again.
module dailyJob 'modules/container-app-job.bicep' = {
  name: 'daily-job'
  scope: rg
  params: {
    location: location
    tags: tags
    name: names.dailyJob
    environmentId: containerAppsEnvironment.outputs.id
    identityId: identity.outputs.id
    registryServer: registry.outputs.loginServer
    image: appImage
    env: appEnv
    cronExpression: dailyJobCron
  }
}

module apim 'modules/apim.bicep' = if (deployApim && appExists) {
  name: 'apim'
  scope: rg
  params: {
    location: location
    tags: tags
    name: names.apim
    publisherEmail: apimPublisherEmail
    publisherName: apimPublisherName
    appUrl: containerApp.outputs.url
  }
}

// ---------------------------------------------------------------------------
// Outputs (azd stores them in .azure/<env>/.env)
// ---------------------------------------------------------------------------

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_RESOURCE_GROUP string = rg.name

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = registry.outputs.name
output AZURE_CONTAINER_ENVIRONMENT_NAME string = containerAppsEnvironment.outputs.name
output AZURE_CONTAINER_APPS_JOB_NAME string = dailyJob.outputs.name

output AZURE_MANAGED_IDENTITY_NAME string = identity.outputs.name
output AZURE_MANAGED_IDENTITY_CLIENT_ID string = identity.outputs.clientId

output SERVICE_APP_NAME string = containerApp.outputs.name
output SERVICE_APP_ENDPOINT_URL string = containerApp.outputs.url
output SERVICE_API_ENDPOINT_URL string = containerApp.outputs.url

output AZURE_KEY_VAULT_NAME string = keyVault.outputs.name
output KEY_VAULT_URI string = keyVault.outputs.uri
output AZURE_OPENAI_ENDPOINT string = openAi.outputs.endpoint
output AZURE_OPENAI_DEPLOYMENT string = openAi.outputs.deploymentName
output AZURE_OPENAI_REGION string = openAi.outputs.location
output DOCINTEL_ENDPOINT string = docIntel.outputs.endpoint
output ACS_ENDPOINT string = communication.outputs.endpoint
output MAIL_SENDER string = communication.outputs.senderAddress
output EVENTGRID_ENDPOINT string = eventGrid.outputs.endpoint
output AUDIT_BLOB_CONTAINER_URL string = storage.outputs.auditContainerUrl
output AZURE_STORAGE_ACCOUNT_NAME string = storage.outputs.name
output POSTGRES_SERVER_NAME string = postgres.outputs.name
output POSTGRES_HOST string = postgres.outputs.fqdn
output POSTGRES_DATABASE string = postgres.outputs.databaseName
output APPLICATIONINSIGHTS_CONNECTION_STRING string = monitoring.outputs.applicationInsightsConnectionString
output APIM_GATEWAY_URL string = (deployApim && appExists) ? apim!.outputs.apiUrl : ''
