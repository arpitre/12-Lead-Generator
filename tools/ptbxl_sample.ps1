<#
    Collect a small, diagnosis-balanced sample of PTB-XL records into one zip.

    Windows only, and needs nothing installed -- PowerShell ships with Windows.
    Use this when Python is not available. It does no analysis: it selects
    records by diagnosis, copies them, and zips them. The waveform analysis
    happens afterwards from the zip.

    Run it from a PowerShell window:

        powershell -ExecutionPolicy Bypass -File ptbxl_sample.ps1 -Root "D:\ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.3"

    Produces ptbxl-sample.zip on your Desktop (roughly 5-10 MB).
    If that is too big to attach anywhere, re-run with  -PerCode 10.
#>

param(
    [Parameter(Mandatory = $true)]
    [string] $Root,

    [string] $OutDir = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ptbxl-sample'),

    [int] $PerCode = 20
)

$ErrorActionPreference = 'Stop'

# SCP codes worth sampling, chosen to line up with the generator's own cases.
# Filtering on raw codes avoids having to parse scp_statements.csv.
$targets = @(
    'NORM',                                  # normal
    'IMI', 'ILMI', 'IPMI', 'IPLMI',          # inferior / inferoposterior MI
    'AMI', 'ASMI', 'ALMI',                   # anterior / anteroseptal / anterolateral MI
    'LMI',                                   # lateral MI
    'ISCAL', 'ISCIN', 'ISCAS',               # ischemia
    'NST_', 'NDT',                           # non-specific ST / T change
    'LVH', 'RVH',                            # hypertrophy
    'CLBBB', 'CRBBB', 'IRBBB', 'LAFB',       # conduction
    'WPW'                                    # pre-excitation
)

$dbPath = Join-Path $Root 'ptbxl_database.csv'
if (-not (Test-Path $dbPath)) {
    throw "Could not find ptbxl_database.csv in '$Root'. Point -Root at the folder that contains it."
}

Write-Host "Reading $dbPath ..." -ForegroundColor Cyan
$rows = Import-Csv $dbPath
Write-Host ("  {0} records in the database" -f $rows.Count)

# Bucket record ids by SCP code, keeping only confident statements.
$buckets = @{}
foreach ($code in $targets) { $buckets[$code] = New-Object System.Collections.ArrayList }

foreach ($row in $rows) {
    # Not $matches: that is a PowerShell automatic variable and writing to it
    # here would clash with the engine's own use of it.
    $found = [regex]::Matches($row.scp_codes, "'([^']+)':\s*([0-9.]+)")
    foreach ($m in $found) {
        $code = $m.Groups[1].Value
        $likelihood = [double] $m.Groups[2].Value
        if ($likelihood -ge 80 -and $buckets.ContainsKey($code)) {
            if ($buckets[$code].Count -lt $PerCode) {
                [void] $buckets[$code].Add($row)
            }
        }
    }
}

# Fresh output folder each run, so repeats do not pile up.
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
$recDir = Join-Path $OutDir 'records'
New-Item -ItemType Directory -Path $recDir -Force | Out-Null

$manifest = New-Object System.Collections.ArrayList
$copied = 0

foreach ($code in $targets) {
    $picked = $buckets[$code]
    Write-Host ("{0,-6} {1,3} records" -f $code, $picked.Count)

    foreach ($row in $picked) {
        # filename_lr is the 100 Hz record, e.g. records100/00000/00001_lr
        $rel = $row.filename_lr -replace '/', '\'
        $src = Join-Path $Root $rel
        $leaf = Split-Path $rel -Leaf

        $ok = $true
        foreach ($ext in @('.dat', '.hea')) {
            if (Test-Path ($src + $ext)) {
                Copy-Item ($src + $ext) (Join-Path $recDir ($leaf + $ext)) -Force
            } else {
                $ok = $false
            }
        }
        if ($ok) {
            [void] $manifest.Add([pscustomobject]@{
                ecg_id = $row.ecg_id
                code   = $code
                record = $leaf
            })
            $copied++
        }
    }
}

$manifest | Export-Csv (Join-Path $OutDir 'manifest.csv') -NoTypeInformation -Encoding UTF8

$zip = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ptbxl-sample.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $zip

$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ""
Write-Host ("Copied {0} records." -f $copied) -ForegroundColor Green
Write-Host ("Created: {0}  ({1} MB)" -f $zip, $sizeMb) -ForegroundColor Green
Write-Host ""
Write-Host "Attach that zip in the chat. If it is too large, run again with -PerCode 10."
