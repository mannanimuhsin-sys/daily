import subprocess
import sys

def main():
    print("Preparing to push to GitHub...")
    subprocess.run(['git', 'add', '-A'], cwd=r'c:\daily')
    subprocess.run(['git', 'commit', '-m', 'Update Islamic Daily Prayer & Routine Tracker v2.0 with parent-controlled multi-child tracking, audit logging, and acceptance tests'], cwd=r'c:\daily')
    
    print("\nPushing main branch to origin (https://github.com/mannanimuhsin-sys/daily.git)...")
    res = subprocess.run(['git', 'push', '-u', 'origin', 'main'], cwd=r'c:\daily')
    if res.returncode == 0:
        print("\n🎉 SUCCESS: Repository pushed successfully to GitHub!")
    else:
        print("\n⚠️ Push failed. Please ensure the repository 'daily' has been created on GitHub under https://github.com/new.")

if __name__ == '__main__':
    main()
