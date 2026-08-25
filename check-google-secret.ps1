<#
    Asks Google directly whether the Client Secret is the right one.

    The code in the request is deliberately invalid, so Google always refuses.
    What matters is how it refuses:
        invalid_client -> the secret is wrong
        invalid_grant  -> the secret is correct, the fault is elsewhere

    The secret is passed as a parameter and is never written to disk.

        powershell -File check-google-secret.ps1 -Secret "GOCSPX-..."

    Output is ASCII on purpose: this console renders Cyrillic in the OEM
    codepage, and the answer has to stay readable whatever that is set to.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Secret
)

# Windows PowerShell 5.1 negotiates TLS 1.0 by default, which Google refuses.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$clientId = "325096920716-elgfnbf4b8me8ldfr1iuvn1f5btsds57.apps.googleusercontent.com"
$redirect = "https://xulkjjjweuikeciudwqz.supabase.co/auth/v1/callback"

$Secret = $Secret.Trim()
Write-Host ("secret length : {0}" -f $Secret.Length)
if ($Secret.StartsWith("GOCSPX-")) {
    Write-Host "secret prefix : GOCSPX- (looks like a secret)"
} elseif ($Secret.EndsWith("googleusercontent.com")) {
    Write-Host "secret prefix : WARNING - this is a Client ID, not a secret"
} else {
    Write-Host "secret prefix : WARNING - a secret usually starts with GOCSPX-"
}
Write-Host ""

$body = @{
    client_id     = $clientId
    client_secret = $Secret
    code          = "deliberately-invalid"
    grant_type    = "authorization_code"
    redirect_uri  = $redirect
}

$errorCode = $null
$raw = $null
try {
    Invoke-RestMethod -Uri "https://oauth2.googleapis.com/token" -Method Post -Body $body -ErrorAction Stop | Out-Null
    $errorCode = "unexpected-success"
} catch {
    $response = $_.Exception.Response
    if ($response -ne $null) {
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $raw = $reader.ReadToEnd()
        $reader.Close()
        try { $errorCode = (ConvertFrom-Json $raw).error } catch { $errorCode = $raw }
    } else {
        $errorCode = $_.Exception.Message
    }
}

Write-Host ("Google answered: {0}" -f $errorCode)
Write-Host ""

if ($errorCode -eq "invalid_grant") {
    Write-Host "RESULT: SECRET IS CORRECT."
    Write-Host "Google accepted the client_id + secret pair and only tripped on the fake code."
    Write-Host "So something else is breaking sign-in. Send me this result."
} elseif ($errorCode -eq "invalid_client") {
    Write-Host "RESULT: SECRET IS WRONG."
    Write-Host "Google does not recognise this pair."
    Write-Host "Google Cloud -> Credentials -> your client -> Add secret,"
    Write-Host "then paste the new value into Supabase -> Authentication -> Providers -> Google."
} else {
    Write-Host "RESULT: unexpected answer. Full body:"
    Write-Host $raw
}
