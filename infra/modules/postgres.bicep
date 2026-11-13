// Azure Database for PostgreSQL Flexible Server with Microsoft Entra
// authentication only (no password login). The app's managed identity is the
// Entra administrator and logs in with a token as user "<identity name>".
//
// Pilot networking: public endpoint with the "allow Azure services" rule.
// Next step for production: VNet integration or a private endpoint.

param location string
param tags object
param name string
param databaseName string = 'vertragsmanagement'
param version string = '16'
param skuName string = 'Standard_B1ms'
param skuTier string = 'Burstable'
param storageSizeGB int = 32
param backupRetentionDays int = 7

@description('Object (principal) ID of the app identity.')
param adminPrincipalId string
@description('Name of the app identity; becomes the PostgreSQL role name.')
param adminPrincipalName string

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: version
    createMode: 'Default'
    storage: {
      storageSizeGB: storageSizeGB
    }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenant().tenantId
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

// The server accepts only one change at a time, so the child resources are
// chained explicitly instead of being created in parallel.
resource administrator 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: server
  name: adminPrincipalId
  properties: {
    principalType: 'ServicePrincipal'
    principalName: adminPrincipalName
    tenantId: tenant().tenantId
  }
}

resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: server
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [
    administrator
  ]
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
  dependsOn: [
    allowAzureServices
  ]
}

output name string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
