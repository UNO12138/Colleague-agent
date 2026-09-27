param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$WindowHandle
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DwmWindowBorder
{
    [DllImport("dwmapi.dll", PreserveSig = true)]
    public static extern int DwmSetWindowAttribute(
        IntPtr hwnd,
        int attribute,
        ref uint value,
        int valueSize);
}
'@

$handle = [IntPtr]::new([Int64]::Parse($WindowHandle))
[uint32]$noBorder = 4294967294
$result = [DwmWindowBorder]::DwmSetWindowAttribute($handle, 34, [ref]$noBorder, 4)

if ($result -lt 0) {
  throw "DwmSetWindowAttribute failed with HRESULT 0x$('{0:X8}' -f $result)."
}
