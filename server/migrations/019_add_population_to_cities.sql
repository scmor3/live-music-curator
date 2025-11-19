-- Purpose: Adds the 'population' column to the cities table and creates an index 
-- to improve search ranking performance.
ALTER TABLE public.cities
ADD COLUMN population integer;

-- Creating a B-tree index on the population column, sorted descending (DESC),
-- to determine rank (i.e., largest population first).
CREATE INDEX idx_cities_population_desc ON public.cities (population DESC);