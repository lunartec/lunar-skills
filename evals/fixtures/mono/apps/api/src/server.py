from .handlers import health

def app(path):
    """Dispatch a path to its handler."""
    return {"/health": health}.get(path, lambda: 404)()
