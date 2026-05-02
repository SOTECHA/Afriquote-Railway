const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (err.code === '23505') {
    return res.status(409).json({ error: 'Duplicate entry — record already exists' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced record does not exist' });
  }
  if (err.code === '22P02') {
    return res.status(400).json({ error: 'Invalid UUID format' });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status < 500 ? err.message : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
