// Key Vault with RBAC authorization. Holds the rotating OneDrive refresh token
// (secret "onedrive-refresh-token"). The secret is deliberately NOT created
// here: a redeploy would overwrite the token the app has rotated.

param location string
param tags object
param name string
param appPrincipalId string
@description('Optional object ID of the person or pipeline running azd; gets "Key Vault Secrets Officer" to store the initial refresh token.')
param deployerPrincipalId string = ''
param enablePurgeProtection bool = false
param logAnalyticsWorkspaceId string

// Key Vault Secrets Officer: the app reads AND writes the rotated token.
var secretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource vault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    // Purge protection cannot be switched off once on; "false" is not a valid value.
    enablePurgeProtection: enablePurgeProtection ? true : null
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource appSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, appPrincipalId, secretsOfficerRoleId)
  scope: vault
  properties: {
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsOfficerRoleId)
  }
}

// principalType is left open: it is a user locally and a service principal in GitHub Actions.
resource deployerSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(vault.id, deployerPrincipalId, secretsOfficerRoleId)
  scope: vault
  properties: {
    principalId: deployerPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsOfficerRoleId)
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: vault
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        categoryGroup: 'audit'
        enabled: true
      }
    ]
  }
}

output name string = vault.name
output uri string = vault.properties.vaultUri
