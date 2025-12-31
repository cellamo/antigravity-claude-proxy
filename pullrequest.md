# Title;
```text
fix sticky accs, 500s, logging updates, and rate limit handling
```

## Description;
```markdown
fixed the sticky account thing where it got stuck on 500 errors.. added a sleep for 500s too.. and stopped the log spam.. oh and also fixed the rate limit stuff so it actually reads the proper delay from google now instead of guessing.. fixed the loop where it stuck to a rate-limited account forever (sticky failover).. also refactored logging.. added colors & a --debug flag so its cleaner.. silenced batch log spam unless ur in debug mode..
```