// Reads the image the Container App currently runs, so that "azd provision"
// does not reset an app deployed with "azd deploy" back to the placeholder.
// azd sets SERVICE_APP_RESOURCE_EXISTS before every provision.

param exists bool
param name string

resource existingApp 'Microsoft.App/containerApps@2025-01-01' existing = if (exists) {
  name: name
}

output containers array = exists ? existingApp!.properties.template.containers : []
