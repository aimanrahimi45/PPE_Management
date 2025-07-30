const Joi = require('joi');

const ppeRequestSchema = Joi.object({
  userId: Joi.string().optional(),
  stationId: Joi.string().required(),
  items: Joi.array().items(
    Joi.object({
      ppeItemId: Joi.string().required(),
      quantity: Joi.number().integer().min(1).max(10).required()
    })
  ).min(1).required(),
  notes: Joi.string().optional(),
  staffId: Joi.string().optional(),
  staffName: Joi.string().optional(),
  department: Joi.string().optional()
});

const validatePPERequest = (req, res, next) => {
  const { error } = ppeRequestSchema.validate(req.body);
  
  if (error) {
    return res.status(400).json({ 
      error: 'Validation failed', 
      details: error.details[0].message 
    });
  }
  
  next();
};

module.exports = { validatePPERequest };