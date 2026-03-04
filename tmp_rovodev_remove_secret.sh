#!/bin/bash

echo "🔒 Removing serviceAccountKey.json from Git history..."
echo ""

# Change to backend directory
cd ~/Tryinterview/tryinterview-backend

# Method 1: Using git filter-branch (works without additional tools)
echo "Step 1: Removing file from Git history..."
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch serviceAccountKey.json" \
  --prune-empty --tag-name-filter cat -- --all

echo ""
echo "Step 2: Cleaning up Git refs..."
rm -rf .git/refs/original/
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo ""
echo "Step 3: Restoring file locally (not in Git)..."
cp ~/serviceAccountKey_BACKUP.json serviceAccountKey.json

echo ""
echo "✅ Done! Now you can force push to GitHub:"
echo ""
echo "   cd ~/Tryinterview/tryinterview-backend"
echo "   git push origin main --force"
echo ""
echo "⚠️  IMPORTANT: After pushing, generate a NEW service account key in Firebase Console"
echo "   and delete the old one, since it was exposed in Git history."
