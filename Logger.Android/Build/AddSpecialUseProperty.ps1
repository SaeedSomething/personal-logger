param(
    [Parameter(Mandatory = $true)]
    [string] $Path
)

if (-not (Test-Path $Path)) {
    exit 0
}

$doc = New-Object System.Xml.XmlDocument
$doc.PreserveWhitespace = $true
$doc.Load($Path)

$ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
$ns.AddNamespace("android", "http://schemas.android.com/apk/res/android")
$services = $doc.SelectNodes("//service[@android:foregroundServiceType='specialUse']", $ns)
if ($null -eq $services) {
    exit 0
}

$changed = $false
foreach ($service in $services) {
    $existing = $service.SelectSingleNode("property[@android:name='android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE']", $ns)
    if ($null -ne $existing) {
        continue
    }

    $property = $doc.CreateElement("property")
    $property.SetAttribute("name", "http://schemas.android.com/apk/res/android", "android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE") | Out-Null
    $property.SetAttribute("value", "http://schemas.android.com/apk/res/android", "Ongoing notification for a personal time logger.") | Out-Null
    [void]$service.AppendChild($property)
    $changed = $true
}

if ($changed) {
    $doc.Save($Path)
}
