/** Embedded source is written locally and executed by Windows PowerShell. The
 * application is suspended until assignment to a kill-on-close Job Object, so
 * even an immediately exiting package-manager wrapper cannot escape ownership. */
export const WINDOWS_JOB_HELPER = String.raw`
param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
$spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.IO;
using System.Collections.Generic;
using System.Net;
public static class HarnssAppJob {
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags;
    public short wShowWindow,cbReserved2; public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess,hThread; public uint dwProcessId,dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT {
    public long perProcess,perJob; public uint flags; public UIntPtr minWorking,maxWorking;
    public uint activeLimit; public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT {
    public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING {
    public long userTime,kernelTime,periodUser,periodKernel; public uint pageFaults,total,active,terminated;
  }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int length; public IntPtr descriptor; public int inherit; }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED_LIMIT info,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out ACCOUNTING info,uint size,IntPtr returned);
  [DllImport("kernel32.dll", EntryPoint="QueryInformationJobObject", SetLastError=true)] static extern bool QueryJobBuffer(IntPtr job,int kind,IntPtr info,uint size,IntPtr returned);
  [DllImport("iphlpapi.dll", SetLastError=true)] static extern uint GetExtendedTcpTable(IntPtr table,ref int size,bool order,int family,int tableClass,uint reserved);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO start,out PROCESS_INFORMATION info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr source,IntPtr handle,IntPtr target,out IntPtr duplicate,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateFile(string name,uint access,uint sharing,ref SECURITY_ATTRIBUTES attributes,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static int stop;
  static string OwnedAddresses(IntPtr job,int port) {
    IntPtr ids=Marshal.AllocHGlobal(65536);
    var owned=new HashSet<uint>();
    try {
      if(!QueryJobBuffer(job,3,ids,65536,IntPtr.Zero)) return "";
      int count=Marshal.ReadInt32(ids,4);
      for(int index=0;index<count && 8+(index+1)*IntPtr.Size<=65536;index++) owned.Add(unchecked((uint)Marshal.ReadIntPtr(ids,8+index*IntPtr.Size).ToInt64()));
    } finally { Marshal.FreeHGlobal(ids); }
    var addresses=new HashSet<string>();
    foreach(int family in new[]{2,23}) {
      int size=0; GetExtendedTcpTable(IntPtr.Zero,ref size,false,family,3,0);
      if(size<=0 || size>16*1024*1024) continue;
      IntPtr table=Marshal.AllocHGlobal(size);
      try {
        if(GetExtendedTcpTable(table,ref size,false,family,3,0)!=0) continue;
        int count=Marshal.ReadInt32(table,0); int rowSize=family==2?24:56; int portOffset=family==2?8:20; int pidOffset=family==2?20:52;
        for(int index=0;index<count && 4+(index+1)*rowSize<=size;index++) {
          int offset=4+index*rowSize;
          int actual=(Marshal.ReadByte(table,offset+portOffset)<<8)|Marshal.ReadByte(table,offset+portOffset+1);
          if(actual==port && owned.Contains(unchecked((uint)Marshal.ReadInt32(table,offset+pidOffset)))) {
            var bytes=new byte[family==2?4:16]; Marshal.Copy(IntPtr.Add(table,offset+(family==2?4:0)),bytes,0,bytes.Length);
            addresses.Add(new IPAddress(bytes).ToString());
          }
        }
      } finally { Marshal.FreeHGlobal(table); }
    }
    return string.Join("\n",addresses);
  }
  static void WriteOwnership(string statusFile,string addresses) {
    string temporary=statusFile+".tmp";
    try { File.WriteAllText(temporary,addresses); if(File.Exists(statusFile)) File.Replace(temporary,statusFile,null); else File.Move(temporary,statusFile); } catch { try { File.Delete(temporary); } catch {} }
  }
  static IntPtr Inherited(int kind) { IntPtr result; if(!DuplicateHandle(GetCurrentProcess(),GetStdHandle(kind),GetCurrentProcess(),out result,0,true,2)) throw new Win32Exception(); return result; }
  public static int Run(string executable,string commandLine,string cwd,int port,string statusFile) {
    IntPtr job=IntPtr.Zero,input=IntPtr.Zero,output=IntPtr.Zero,error=IntPtr.Zero;
    PROCESS_INFORMATION process=new PROCESS_INFORMATION(); bool assigned=false;
    try {
      job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Win32Exception();
      EXTENDED_LIMIT limits=new EXTENDED_LIMIT(); limits.basic.flags=0x2000;
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT)))) throw new Win32Exception();
      SECURITY_ATTRIBUTES attrs=new SECURITY_ATTRIBUTES(); attrs.length=Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)); attrs.inherit=1;
      input=CreateFile("NUL",0x80000000,3,ref attrs,3,0,IntPtr.Zero);
      if(input==new IntPtr(-1)) throw new Win32Exception();
      output=Inherited(-11); error=Inherited(-12);
      STARTUPINFO startup=new STARTUPINFO(); startup.cb=Marshal.SizeOf(typeof(STARTUPINFO)); startup.dwFlags=0x100;
      startup.hStdInput=input; startup.hStdOutput=output; startup.hStdError=error;
      if(!CreateProcess(executable,new StringBuilder(commandLine),IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref startup,out process)) throw new Win32Exception();
      if(!AssignProcessToJobObject(job,process.hProcess)) throw new Win32Exception(); assigned=true;
      if(ResumeThread(process.hThread)==0xffffffff) throw new Win32Exception();
      var reader=new Thread(()=>{ try { while(Console.ReadLine()!=null) { Interlocked.Exchange(ref stop,1); break; } } catch {} finally { Interlocked.Exchange(ref stop,1); } });
      reader.IsBackground=true; reader.Start();
      int lastOwnership=Environment.TickCount-250;
      while(true) {
        ACCOUNTING accounting;
        if(!QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero)) throw new Win32Exception();
        if(port>0 && unchecked(Environment.TickCount-lastOwnership)>=250) { WriteOwnership(statusFile,OwnedAddresses(job,port)); lastOwnership=Environment.TickCount; }
        if(accounting.active==0) break;
        if(Interlocked.CompareExchange(ref stop,0,0)!=0) { if(!TerminateJobObject(job,0)) throw new Win32Exception(); }
        Thread.Sleep(50);
      }
      uint exitCode; return GetExitCodeProcess(process.hProcess,out exitCode) ? unchecked((int)exitCode) : 1;
    } finally {
      if(!assigned && process.hProcess!=IntPtr.Zero) TerminateProcess(process.hProcess,1);
      if(job!=IntPtr.Zero) CloseHandle(job);
      if(port>0) WriteOwnership(statusFile,"");
      if(process.hThread!=IntPtr.Zero) CloseHandle(process.hThread);
      if(process.hProcess!=IntPtr.Zero) CloseHandle(process.hProcess);
      foreach(var handle in new[]{input,output,error}) if(handle!=IntPtr.Zero && handle!=new IntPtr(-1)) CloseHandle(handle);
    }
  }
}
'@
exit [HarnssAppJob]::Run([string]$spec.executable, [string]$spec.commandLine, [string]$spec.cwd, [int]$spec.port, [string]$spec.statusFile)
`;

export function quoteWindowsArgument(value: string): string {
  if (value && !/[\s"]/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\*)$/, "$1$1")}"`;
}
