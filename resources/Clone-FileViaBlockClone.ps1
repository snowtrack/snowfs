<#
.NOTES
    Written by Sergey Gruzdov
    
    .SYNOPSIS
        Clone files using ReFS block cloning

    .DESCRIPTION
        Clone files using ReFS block cloning. Volume must be formatted in Server 2016 ReFS and files must reside on same volume

    .PARAMETER $InFile
        Source file to be cloned

    .PARAMETER $OutFile
        Destination file
#>

param(
    [ValidateNotNullOrEmpty()]
    $InFile,

    [ValidateNotNullOrEmpty()]
    $OutFile
)

$FILE_SUPPORTS_BLOCK_REFCOUNTING = 0x08000000
$GENERIC_READ = 0x80000000L
$GENERIC_WRITE = 0x40000000L
$DELETE = 0x00010000L
$FILE_SHARE_READ = 0x00000001
$OPEN_EXISTING = 3
$CREATE_NEW = 1
$INVALID_HANDLE_VALUE = -1
$SIZEOF_FSCTL_GET_INTEGRITY_INFORMATION_BUFFER = 16
$SIZEOF_FSCTL_SET_INTEGRITY_INFORMATION_BUFFER = 8
$SIZEOF_FILE_END_OF_FILE_INFO = 8
$SIZEOF_FILE_DISPOSITION_INFO = 1
$SIZEOF_DUPLICATE_EXTENTS_DATA = 32
$FSCTL_GET_INTEGRITY_INFORMATION = 0x9027C
$FSCTL_SET_INTEGRITY_INFORMATION = 0x9C280
$FSCTL_DUPLICATE_EXTENTS_TO_FILE = 0x98344
$FileEndOfFileInfo = 6
$FileDispositionInfo = 4

$StructsDefinition = @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;

namespace CloneStructs
{
    [StructLayout(LayoutKind.Sequential)]
    public struct FSCTL_GET_INTEGRITY_INFORMATION_BUFFER
    {
        public ushort ChecksumAlgorithm;
        public ushort Reserved;
        public uint Flags;
        public uint ChecksumChunkSizeInBytes;
        public uint ClusterSizeInBytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct FSCTL_SET_INTEGRITY_INFORMATION_BUFFER 
    {
        public ushort   ChecksumAlgorithm;
        public ushort   Reserved;
        public uint Flags;
    }
    
    [StructLayout(LayoutKind.Sequential)]
    public struct FILE_DISPOSITION_INFO
    {
        public bool DeleteFile;
    }

    public struct FILE_END_OF_FILE_INFO 
    {
        public ulong EndOfFile;
    }

    public struct DUPLICATE_EXTENTS_DATA 
    {
        public IntPtr FileHandle;
        public ulong SourceFileOffset;
        public ulong TargetFileOffset;
        public ulong ByteCount;
    }
}
'@

$MethodDefinitions = @’
[DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
public static extern IntPtr CreateFileW(
    string lpFileName,
    ulong dwDesiredAccess,
    ulong dwShareMode,
    IntPtr lpSecurityAttributes,
    ulong dwCreationDisposition,
    ulong dwFlagsAndAttributes,
    IntPtr hTemplateFile
    );

[DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
public static extern bool CloseHandle(IntPtr hObject);

[DllImport("kernel32.dll")]
public static extern ulong GetLastError();

[DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
public static extern bool GetVolumeInformationByHandleW(
    IntPtr hFile,
    IntPtr lpVolumeNameBuffer,
    ulong nVolumeNameSize,
    IntPtr lpVolumeSerialNumber,
    IntPtr lpMaximumComponentLength,
    out ulong lpFileSystemFlags,
    IntPtr lpFileSystemNameBuffer,
    ulong nFileSystemNameSize);

[DllImport("kernel32.dll")]
public static extern bool GetFileSizeEx(IntPtr hFile, out ulong lpFileSize);

[DllImport("kernel32.dll")]
public static extern bool DeleteFileW(string lpFileName);

[DllImport("kernel32.dll")]
public static extern bool DeviceIoControl(
    IntPtr hDevice,
    ulong dwIoControlCode,
    IntPtr lpInBuffer,
    ulong nInBufferSize,
    IntPtr lpOutBuffer,
    ulong nOutBufferSize,
    out ulong lpBytesReturned,
    IntPtr lpOverlapped
    );

[DllImport("kernel32.dll")]
public static extern bool SetFileInformationByHandle(
    IntPtr hFile,
    int FileInformationClass,
    IntPtr lpFileInformation,
    ulong dwBufferSize
    );
‘@

$startTime = Get-Date
$status = $true
$hInFile = $INVALID_HANDLE_VALUE
$hOutFile = $INVALID_HANDLE_VALUE
$dwRet = 0
try
{
    $Methods = Add-Type -MemberDefinition $MethodDefinitions -Name 'Methods' -Namespace 'Win32' -PassThru
    Add-Type -TypeDefinition $StructsDefinition

    $hInFile = $Methods::CreateFileW($InFile, $GENERIC_READ, $FILE_SHARE_READ, [IntPtr]::Zero, $OPEN_EXISTING, 0, [IntPtr]::Zero)
    if ($hInFile -eq $INVALID_HANDLE_VALUE)
    {
        throw "Unable open file '$InFile'"
    }

    $dwVolumeFlags = 0
	if (! $($Methods::GetVolumeInformationByHandleW($hInFile, [IntPtr]::Zero, 0, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$dwVolumeFlags, [IntPtr]::Zero, 0)))
    {
        throw "Unable to get volume information for source file"
    }
    
	if (!($dwVolumeFlags -band $FILE_SUPPORTS_BLOCK_REFCOUNTING))
	{
		throw "Volume not supported block cloning!"
	}
    

    $SourceFileSize = 0
    if (!$($Methods::GetFileSizeEx($hInFile, [ref]$SourceFileSize)))
    {
        throw "Unable to get size of source file '$InFile'"
    }

	$hOutFile = $Methods::CreateFileW($OutFile, $GENERIC_READ -bor $GENERIC_WRITE -bor $DELETE, 0, [IntPtr]::Zero, $CREATE_NEW, 0, $hInFile)
	if ($hOutFile -eq $INVALID_HANDLE_VALUE)
	{
	    throw "Unable to create output file '$OutFile'"
	}

    $disposeInfo = New-Object CloneStructs.FILE_DISPOSITION_INFO
    $disposeInfo.DeleteFile = $true
    $ptrInfo = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($SIZEOF_FILE_DISPOSITION_INFO)
    [System.Runtime.InteropServices.Marshal]::StructureToPtr($disposeInfo, $ptrInfo, $false)
    $result = $Methods::SetFileInformationByHandle($hOutFile, $FileDispositionInfo, $ptrInfo, $SIZEOF_FILE_DISPOSITION_INFO)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrInfo)
	if (!$result)
	{
        throw "Unable to set file disposition"
    }

    $endOfOutFileInfo = New-Object CloneStructs.FILE_END_OF_FILE_INFO
    $endOfOutFileInfo.EndOfFile = $SourceFileSize
    $ptrInfo = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($SIZEOF_FILE_END_OF_FILE_INFO)
    [System.Runtime.InteropServices.Marshal]::StructureToPtr($endOfOutFileInfo, $ptrInfo, $false)
    $result = $Methods::SetFileInformationByHandle($hOutFile, $FileEndOfFileInfo, $ptrInfo, $SIZEOF_FILE_END_OF_FILE_INFO)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrInfo)
	if (!$result)
	{
        throw "Unable to set end of output file"
    }
    
    $sourceFileIntegrity = New-Object CloneStructs.FSCTL_GET_INTEGRITY_INFORMATION_BUFFER
    $type = $sourceFileIntegrity.GetType()
    $ptrInfo = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($SIZEOF_FSCTL_GET_INTEGRITY_INFORMATION_BUFFER)
    if (!$($Methods::DeviceIoControl($hInFile, $FSCTL_GET_INTEGRITY_INFORMATION, [IntPtr]::Zero, 0, $ptrInfo, $SIZEOF_FSCTL_GET_INTEGRITY_INFORMATION_BUFFER, [ref]$dwRet, [IntPtr]::Zero)))
	{
	    throw "Unable get intergrity of input file"
	}
    $sourceFileIntegrity = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptrInfo,[System.Type]$type)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrInfo)

    $tragetFileIntegrity = New-Object CloneStructs.FSCTL_SET_INTEGRITY_INFORMATION_BUFFER
    $tragetFileIntegrity.ChecksumAlgorithm = $sourceFileIntegrity.ChecksumAlgorithm
    $tragetFileIntegrity.Reserved = $sourceFileIntegrity.Reserved
    $tragetFileIntegrity.Flags = $sourceFileIntegrity.Flags
    $ptrInfo = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($SIZEOF_FSCTL_SET_INTEGRITY_INFORMATION_BUFFER);
    [System.Runtime.InteropServices.Marshal]::StructureToPtr($tragetFileIntegrity, $ptrInfo, $true)
    $result = $Methods::DeviceIoControl($hOutFile, $FSCTL_SET_INTEGRITY_INFORMATION, $ptrInfo, $SIZEOF_FSCTL_SET_INTEGRITY_INFORMATION_BUFFER, [IntPtr]::Zero, 0, [ref]$dwRet, [IntPtr]::Zero)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrInfo)
    if (!$result)
	{
	    throw "Unable to set intergrity of output file"
	}
    #

    $ByteCount = 1Gb

    $ptrInfo = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($SIZEOF_DUPLICATE_EXTENTS_DATA);
    $dupExtent = New-Object CloneStructs.DUPLICATE_EXTENTS_DATA
    $dupExtent.FileHandle = $hInFile
    $dupExtent.ByteCount = $ByteCount
    $FileOffset = 0
    

    while ($FileOffset -le $SourceFileSize)
    {
	    $dupExtent.SourceFileOffset = $FileOffset
		$dupExtent.TargetFileOffset = $FileOffset

        if ($FileOffset + $ByteCount -gt $SourceFileSize)
        {
            $dupExtent.ByteCount = $SourceFileSize - $FileOffset
        }

        [System.Runtime.InteropServices.Marshal]::StructureToPtr($dupExtent, $ptrInfo, $false)
        if (!$($Methods::DeviceIoControl($hOutFile, $FSCTL_DUPLICATE_EXTENTS_TO_FILE, $ptrInfo, $SIZEOF_DUPLICATE_EXTENTS_DATA, [IntPtr]::Zero, 0, [ref]$dwRet, [IntPtr]::Zero)))
        {
            throw $("DeviceIoControl failed at offset: {0}", $FileOffset)
        }

        $FileOffset += $ByteCount
    }
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrInfo)


    # clear disposition flag, so file dont delete on close
    $disposeInfo.DeleteFile = $false
    $ptrInfo = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($SIZEOF_FILE_DISPOSITION_INFO)
    [System.Runtime.InteropServices.Marshal]::StructureToPtr($disposeInfo, $ptrInfo, $false)
    $result = $Methods::SetFileInformationByHandle($hOutFile, $FileDispositionInfo, $ptrInfo, $SIZEOF_FILE_DISPOSITION_INFO)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrInfo)
	if (!$result)
	{
        throw "Unable to set file disposition"
    }

	$endTime = Get-Date
	$elapsed = $endTime - $startTime

	Write-Host "Completed in $($elapsed.Seconds).$($elapsed.Milliseconds) second(s)"
}
catch
{
	$code = -1
	if ($Methods -ne $null)
	{
		$code = $Methods::GetLastError()
	}

    Write-Host $("$($_): Error {0:X}" -f $code)
    $status = $false
}
finally
{
    if ($hInFile -ne $INVALID_HANDLE_VALUE)
    {
        [void]$Methods::CloseHandle($hInFile)
    }
    if ($hOutFile -ne $INVALID_HANDLE_VALUE)
    {
        [void]$Methods::CloseHandle($hOutFile)
    }
}

# SIG # Begin signature block
# MIINGwYJKoZIhvcNAQcCoIINDDCCDQgCAQExCzAJBgUrDgMCGgUAMGkGCisGAQQB
# gjcCAQSgWzBZMDQGCisGAQQBgjcCAR4wJgIDAQAABBAfzDtgWUsITrck0sYpfvNR
# AgEAAgEAAgEAAgEAAgEAMCEwCQYFKw4DAhoFAAQU52PNZAtann+Mot26Pl8RC4cY
# /26gggpdMIIFJTCCBA2gAwIBAgIQARxiFOgyP7vHGfA8b0Y6oDANBgkqhkiG9w0B
# AQsFADByMQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYD
# VQQLExB3d3cuZGlnaWNlcnQuY29tMTEwLwYDVQQDEyhEaWdpQ2VydCBTSEEyIEFz
# c3VyZWQgSUQgQ29kZSBTaWduaW5nIENBMB4XDTIxMDIxMDAwMDAwMFoXDTIyMDIx
# NjIzNTk1OVowYzELMAkGA1UEBhMCQ0ExDzANBgNVBAgTBlF1ZWJlYzERMA8GA1UE
# BxMITW9udHJlYWwxFzAVBgNVBAoTDlNub3d0cmFjayBJbmMuMRcwFQYDVQQDEw5T
# bm93dHJhY2sgSW5jLjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMRU
# PcryqwAqR8deaxrmO+PLJz2B3nUcCn82plp31PIRpuuUnhdlurnSEyLgDNua0x28
# vUB8Oe9huV1zNdEYQsfMR15aoy8PuATT20wh80tfPPp5XwMY4zyOIXmLWjKlguW2
# ntqadlVX5o/ammQU8qmBD0QI2+Eq6BgR22vxONcf5huIEwwnzBJ04mSdjOOXJKIJ
# Bwt2TiJP4MyVXvp5Ooim3+FYfDRW2Nh6gJ9pQuKczeCtKjBzjXMxv+ck68VE4zAb
# 8nzgg/SrD2yAR3KZwknX9XzBnrNgi/OlsbnWLoV7x9hAcHk8X16ysxpEzRhOacSP
# hGmJYfzQm0UmHY4T2WECAwEAAaOCAcQwggHAMB8GA1UdIwQYMBaAFFrEuXsqCqOl
# 6nEDwGD5LfZldQ5YMB0GA1UdDgQWBBQOmw2Ua03yW40SX+ejCIqvLTuSyzAOBgNV
# HQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwMwdwYDVR0fBHAwbjA1oDOg
# MYYvaHR0cDovL2NybDMuZGlnaWNlcnQuY29tL3NoYTItYXNzdXJlZC1jcy1nMS5j
# cmwwNaAzoDGGL2h0dHA6Ly9jcmw0LmRpZ2ljZXJ0LmNvbS9zaGEyLWFzc3VyZWQt
# Y3MtZzEuY3JsMEsGA1UdIAREMEIwNgYJYIZIAYb9bAMBMCkwJwYIKwYBBQUHAgEW
# G2h0dHA6Ly93d3cuZGlnaWNlcnQuY29tL0NQUzAIBgZngQwBBAEwgYQGCCsGAQUF
# BwEBBHgwdjAkBggrBgEFBQcwAYYYaHR0cDovL29jc3AuZGlnaWNlcnQuY29tME4G
# CCsGAQUFBzAChkJodHRwOi8vY2FjZXJ0cy5kaWdpY2VydC5jb20vRGlnaUNlcnRT
# SEEyQXNzdXJlZElEQ29kZVNpZ25pbmdDQS5jcnQwDAYDVR0TAQH/BAIwADANBgkq
# hkiG9w0BAQsFAAOCAQEAhe1VCNKX7Cb8e4/xa/sTux4a6Qyq7kbZlMaJcxd+uJNs
# jzrx9cilramqLdhFKeLviq04W6K9UUEuajU0uVFjiIJ83/ZPPNnDaBTIBXX7P5DF
# aRWalQEOVjWGEcWGFBDz5UUka+bJvZJ/MpcFZxZlwt9QwyJSG7wp8mIqNMIdosP7
# iP05MceAdNeQK1D2Pg9oyZLGiAd9BLwnfzkjYHoFbAMx7PQ/Bb0O/A3RV8mDhvkE
# ZCBlCmrfR154zl/E/UepvQe4DR2966uKC83W5gsjsC4dF11N5iN4ZRw3ThnY6xwk
# oyJDGAFPT4e4+pTrHO10DAuUilHReAqFhSrXV5dB1zCCBTAwggQYoAMCAQICEAQJ
# GBtf1btmdVNDtW+VUAgwDQYJKoZIhvcNAQELBQAwZTELMAkGA1UEBhMCVVMxFTAT
# BgNVBAoTDERpZ2lDZXJ0IEluYzEZMBcGA1UECxMQd3d3LmRpZ2ljZXJ0LmNvbTEk
# MCIGA1UEAxMbRGlnaUNlcnQgQXNzdXJlZCBJRCBSb290IENBMB4XDTEzMTAyMjEy
# MDAwMFoXDTI4MTAyMjEyMDAwMFowcjELMAkGA1UEBhMCVVMxFTATBgNVBAoTDERp
# Z2lDZXJ0IEluYzEZMBcGA1UECxMQd3d3LmRpZ2ljZXJ0LmNvbTExMC8GA1UEAxMo
# RGlnaUNlcnQgU0hBMiBBc3N1cmVkIElEIENvZGUgU2lnbmluZyBDQTCCASIwDQYJ
# KoZIhvcNAQEBBQADggEPADCCAQoCggEBAPjTsxx/DhGvZ3cH0wsxSRnP0PtFmbE6
# 20T1f+Wondsy13Hqdp0FLreP+pJDwKX5idQ3Gde2qvCchqXYJawOeSg6funRZ9PG
# +yknx9N7I5TkkSOWkHeC+aGEI2YSVDNQdLEoJrskacLCUvIUZ4qJRdQtoaPpiCwg
# la4cSocI3wz14k1gGL6qxLKucDFmM3E+rHCiq85/6XzLkqHlOzEcz+ryCuRXu0q1
# 6XTmK/5sy350OTYNkO/ktU6kqepqCquE86xnTrXE94zRICUj6whkPlKWwfIPEvTF
# jg/BougsUfdzvL2FsWKDc0GCB+Q4i2pzINAPZHM8np+mM6n9Gd8lk9ECAwEAAaOC
# Ac0wggHJMBIGA1UdEwEB/wQIMAYBAf8CAQAwDgYDVR0PAQH/BAQDAgGGMBMGA1Ud
# JQQMMAoGCCsGAQUFBwMDMHkGCCsGAQUFBwEBBG0wazAkBggrBgEFBQcwAYYYaHR0
# cDovL29jc3AuZGlnaWNlcnQuY29tMEMGCCsGAQUFBzAChjdodHRwOi8vY2FjZXJ0
# cy5kaWdpY2VydC5jb20vRGlnaUNlcnRBc3N1cmVkSURSb290Q0EuY3J0MIGBBgNV
# HR8EejB4MDqgOKA2hjRodHRwOi8vY3JsNC5kaWdpY2VydC5jb20vRGlnaUNlcnRB
# c3N1cmVkSURSb290Q0EuY3JsMDqgOKA2hjRodHRwOi8vY3JsMy5kaWdpY2VydC5j
# b20vRGlnaUNlcnRBc3N1cmVkSURSb290Q0EuY3JsME8GA1UdIARIMEYwOAYKYIZI
# AYb9bAACBDAqMCgGCCsGAQUFBwIBFhxodHRwczovL3d3dy5kaWdpY2VydC5jb20v
# Q1BTMAoGCGCGSAGG/WwDMB0GA1UdDgQWBBRaxLl7KgqjpepxA8Bg+S32ZXUOWDAf
# BgNVHSMEGDAWgBRF66Kv9JLLgjEtUYunpyGd823IDzANBgkqhkiG9w0BAQsFAAOC
# AQEAPuwNWiSz8yLRFcgsfCUpdqgdXRwtOhrE7zBh134LYP3DPQ/Er4v97yrfIFU3
# sOH20ZJ1D1G0bqWOWuJeJIFOEKTuP3GOYw4TS63XX0R58zYUBor3nEZOXP+QsRsH
# DpEV+7qvtVHCjSSuJMbHJyqhKSgaOnEoAjwukaPAJRHinBRHoXpoaK+bp1wgXNlx
# sQyPu6j4xRJon89Ay0BEpRPw5mQMJQhCMrI2iiQC/i9yfhzXSUWW6Fkd6fp0ZGuy
# 62ZD2rOwjNXpDd32ASDOmTFjPQgaGLOBm0/GkxAG/AeB+ova+YJJ92JuoVP6EpQY
# hS6SkepobEQysmah5xikmmRR7zGCAigwggIkAgEBMIGGMHIxCzAJBgNVBAYTAlVT
# MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
# b20xMTAvBgNVBAMTKERpZ2lDZXJ0IFNIQTIgQXNzdXJlZCBJRCBDb2RlIFNpZ25p
# bmcgQ0ECEAEcYhToMj+7xxnwPG9GOqAwCQYFKw4DAhoFAKB4MBgGCisGAQQBgjcC
# AQwxCjAIoAKAAKECgAAwGQYJKoZIhvcNAQkDMQwGCisGAQQBgjcCAQQwHAYKKwYB
# BAGCNwIBCzEOMAwGCisGAQQBgjcCARUwIwYJKoZIhvcNAQkEMRYEFC1yjC4asKfG
# qlIlRhr4EaCK/G/8MA0GCSqGSIb3DQEBAQUABIIBAMAn7lt3x8cnQGPkafrs++KA
# /w58TMv8aDGLpenbDCq0/i27Hy6gaQxmLnjWR7DfciN5CQ73xF7cB+ohoOn5HSSt
# dxQHragxTLCVUYTfs+WSHSjp0nrbc4uvtRxYa+REj4Kfv5mVPMnahPIAZtAjQIAW
# oMLefRQTFp4VA/Hdavx8MzDqVyKNx3E8eqhCRxdwyboFTE6vKUFwZXQ/G+fbP8eN
# tQEKVobwOJr05IoglIPSLqwXV1GRBW+9h854yGiIXIKwUh+VHFf2c9RzS+JxLWtG
# xfh80PmdtqTvO3YeQO7/aYdYMzTy1NXCR6VjMAIgI+QNbQtkWCKAPh3jnJ+42fM=
# SIG # End signature block
