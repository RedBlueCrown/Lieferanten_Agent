# azd postdeploy hook (service "app"), Windows variant of postdeploy.sh.
# "azd deploy" only updates the Container App. This moves the daily
# Container Apps Job to the same image. Without the Azure CLI the job keeps
# its previous image until the next "azd provision", which aligns it again.
$ErrorActionPreference = 'Stop'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  Write-Warning "postdeploy: Azure CLI not found; the daily job is updated on the next 'azd provision'."
  exit 0
}
az account show --output none 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Warning "postdeploy: Azure CLI is not signed in ('az login'); the daily job is updated on the next 'azd provision'."
  exit 0
}

foreach ($name in 'AZURE_SUBSCRIPTION_ID', 'AZURE_RESOURCE_GROUP', 'SERVICE_APP_NAME', 'AZURE_CONTAINER_APPS_JOB_NAME') {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "postdeploy: $name is not set" }
}

# Install the containerapp extension on first use without prompting.
$env:AZURE_EXTENSION_USE_DYNAMIC_INSTALL = 'yes_without_prompt'

$image = az containerapp show `
  --subscription $env:AZURE_SUBSCRIPTION_ID `
  --resource-group $env:AZURE_RESOURCE_GROUP `
  --name $env:SERVICE_APP_NAME `
  --query 'properties.template.containers[0].image' `
  --output tsv
if ($LASTEXITCODE -ne 0) { throw 'postdeploy: could not read the app image' }

Write-Host "postdeploy: updating job $($env:AZURE_CONTAINER_APPS_JOB_NAME) to $image"
az containerapp job update `
  --subscription $env:AZURE_SUBSCRIPTION_ID `
  --resource-group $env:AZURE_RESOURCE_GROUP `
  --name $env:AZURE_CONTAINER_APPS_JOB_NAME `
  --container-name daily `
  --image $image `
  --output none
if ($LASTEXITCODE -ne 0) { throw 'postdeploy: job update failed' }
