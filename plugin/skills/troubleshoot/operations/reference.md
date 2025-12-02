# Quick Commands Reference

Essential commands for troubleshooting rad-mem.

## Worker Management

```bash
# Check worker status
pm2 status | grep rad-mem-worker
pm2 jlist | grep rad-mem-worker  # JSON format

# Start worker
cd ~/.claude/plugins/marketplaces/thedotmack/
pm2 start ecosystem.config.cjs

# Restart worker
pm2 restart rad-mem-worker

# Stop worker
pm2 stop rad-mem-worker

# Delete worker (for clean restart)
pm2 delete rad-mem-worker

# View logs
pm2 logs rad-mem-worker

# View last N lines
pm2 logs rad-mem-worker --lines 50 --nostream

# Clear logs
pm2 flush rad-mem-worker
```

## Health Checks

```bash
# Check worker health (default port)
curl -s http://127.0.0.1:38888/health

# Check viewer stats
curl -s http://127.0.0.1:38888/api/stats

# Open viewer in browser
open http://127.0.0.1:38888

# Test custom port
PORT=37778
curl -s http://127.0.0.1:$PORT/health
```

## Database Queries

```bash
# Observation count
sqlite3 ~/.rad-mem/rad-mem.db "SELECT COUNT(*) FROM observations;"

# Session count
sqlite3 ~/.rad-mem/rad-mem.db "SELECT COUNT(*) FROM sessions;"

# Recent observations
sqlite3 ~/.rad-mem/rad-mem.db "SELECT created_at, type, title FROM observations ORDER BY created_at DESC LIMIT 10;"

# Recent sessions
sqlite3 ~/.rad-mem/rad-mem.db "SELECT created_at, request FROM sessions ORDER BY created_at DESC LIMIT 5;"

# Database size
du -h ~/.rad-mem/rad-mem.db

# Database integrity check
sqlite3 ~/.rad-mem/rad-mem.db "PRAGMA integrity_check;"

# Projects in database
sqlite3 ~/.rad-mem/rad-mem.db "SELECT DISTINCT project FROM observations ORDER BY project;"
```

## Configuration

```bash
# View current settings
cat ~/.rad-mem/settings.json
cat ~/.claude/settings.json

# Change worker port
echo '{"env":{"CLAUDE_MEM_WORKER_PORT":"37778"}}' > ~/.rad-mem/settings.json

# Change context observation count
# Edit ~/.claude/settings.json and add:
{
  "env": {
    "CLAUDE_MEM_CONTEXT_OBSERVATIONS": "25"
  }
}

# Change AI model
{
  "env": {
    "CLAUDE_MEM_MODEL": "claude-haiku-4-5"
  }
}
```

## Plugin Management

```bash
# Navigate to plugin directory
cd ~/.claude/plugins/marketplaces/thedotmack/

# Check plugin version
grep '"version"' package.json

# Reinstall dependencies
npm install

# View package.json
cat package.json
```

## Port Diagnostics

```bash
# Check what's using port 37777
lsof -i :38888
netstat -tlnp | grep 37777

# Test port connectivity
nc -zv 127.0.0.1 37777
curl -v http://127.0.0.1:38888/health
```

## Log Analysis

```bash
# Search logs for errors
pm2 logs rad-mem-worker --lines 100 --nostream | grep -i "error"

# Search for specific keyword
pm2 logs rad-mem-worker --lines 100 --nostream | grep "keyword"

# Follow logs in real-time
pm2 logs rad-mem-worker

# Show only error logs
pm2 logs rad-mem-worker --err
```

## File Locations

```bash
# Plugin directory
~/.claude/plugins/marketplaces/thedotmack/

# Database
~/.rad-mem/rad-mem.db

# Settings
~/.rad-mem/settings.json
~/.claude/settings.json

# Chroma vector database
~/.rad-mem/chroma/

# Usage logs
~/.rad-mem/usage-logs/

# PM2 logs
~/.pm2/logs/
```

## System Information

```bash
# OS version
uname -a

# Node version
node --version

# NPM version
npm --version

# PM2 version
pm2 --version

# SQLite version
sqlite3 --version

# Check disk space
df -h ~/.rad-mem/
```
