// Log Analytics workspace and workspace-based Application Insights.

param location string
param tags object
param logAnalyticsName string
param applicationInsightsName string
@description('Principal ID of the app identity; gets "Monitoring Metrics Publisher" so telemetry can later be sent with Entra auth only.')
param appPrincipalId string
param retentionInDays int = 30

// Monitoring Metrics Publisher
var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
    // Local (instrumentation key) ingestion stays enabled for the pilot: the
    // connection string is not a secret, and the API's OpenTelemetry setup
    // would need an explicit credential for Entra-only ingestion. The role
    // below is already in place, so switching later is a one-line change.
    DisableLocalAuth: false
  }
}

resource metricsPublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(applicationInsights.id, appPrincipalId, monitoringMetricsPublisherRoleId)
  scope: applicationInsights
  properties: {
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
  }
}

output logAnalyticsWorkspaceId string = logAnalytics.id
output logAnalyticsWorkspaceName string = logAnalytics.name
output applicationInsightsName string = applicationInsights.name
output applicationInsightsConnectionString string = applicationInsights.properties.ConnectionString
