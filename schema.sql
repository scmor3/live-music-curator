--
-- PostgreSQL database dump
--
-- Dumped from database version 16.10 (Ubuntu 16.10-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.10 (Ubuntu 16.10-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: cities; Type: TABLE; Schema: public; Owner: curator_app
--

CREATE TABLE public.cities (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    city character varying(255),
    admin_name character varying(255),
    country character varying(255)
);

--
-- Name: cities_id_seq; Type: SEQUENCE; Schema: public; Owner: curator_app
--

CREATE SEQUENCE public.cities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: cities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: curator_app
--

ALTER SEQUENCE public.cities_id_seq OWNED BY public.cities.id;


--
-- Name: curated_artists; Type: TABLE; Schema: public; Owner: curator_app
--

CREATE TABLE public.curated_artists (
    id integer NOT NULL,
    curation_request_id integer,
    artist_name_raw character varying(255) NOT NULL,
    spotify_artist_id text,
    confidence_score numeric(5,2)
);

--
-- Name: curated_artists_id_seq; Type: SEQUENCE; Schema: public; Owner: curator_app
--

CREATE SEQUENCE public.curated_artists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: curated_artists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: curator_app
--

ALTER SEQUENCE public.curated_artists_id_seq OWNED BY public.curated_artists.id;


--
-- Name: curation_requests; Type: TABLE; Schema: public; Owner: curator_app
--

CREATE TABLE public.curation_requests (
    id integer NOT NULL,
    search_city character varying(255) NOT NULL,
    search_date date NOT NULL,
    number_of_songs integer NOT NULL,
    playlist_id text
);

--
-- Name: curation_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: curator_app
--

CREATE SEQUENCE public.curation_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: curation_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: curator_app
--

ALTER SEQUENCE public.curation_requests_id_seq OWNED BY public.curation_requests.id;


--
-- Name: migrations; Type: TABLE; Schema: public; Owner: curator_app
--

CREATE TABLE public.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

--
-- Name: cities id; Type: DEFAULT; Schema: public; Owner: curator_app
--

ALTER TABLE ONLY public.cities ALTER COLUMN id SET DEFAULT nextval('public.cities_id_seq'::regclass);


--
-- Name: curated_artists id; Type: DEFAULT; Schema: public; Owner: curator_app
--

ALTER TABLE ONLY public.curated_artists ALTER COLUMN id SET DEFAULT nextval('public.curated_artists_id_seq'::regclass);


--
-- Name: curation_requests id; Type: DEFAULT; Schema: public; Owner: curator_app
--

ALTER TABLE ONLY public.curation_requests ALTER COLUMN id SET DEFAULT nextval('public.curation_requests_id_seq'::regclass);


--
-- Name: cities cities_name_unique; Type: CONSTRAINT; Schema: public; Owner: curator_app
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_name_unique UNIQUE (name);


--
-- Name: cities cities_pkey; Type: CONSTRAINT; Schema: public; Owner: curator_app
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (id);


--
-- Name: curated_artists curated_artists_pkey; Type: CONSTRAINT; Schema: public; Owner: curator_app
--

ALTER TABLE ONLY public.curated_artists
    ADD CONSTRAINT curated_artists_pkey PRIMARY KEY (id);


--
-- Name: curation_requests curation_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: curator_app
--

ALTER TABLE ONLY public.curation_requests
    ADD CONSTRAINT curation_requests_pkey PRIMARY KEY (id);


--
-- Name: curation_requests curation_requests_playlist_id_key; Type: CONSTRAINT; Schema: public; Owner: curator_app
--

ALTER TABLE ONLY public.curation_requests
    ADD CONSTRAINT curation_requests_playlist_id_key UNIQUE (playlist_id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: public; Owner: curator_app
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: curator_app
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: idx_cities_name_trgm; Type: INDEX; Schema: public; Owner: curator_app
--

CREATE INDEX idx_cities_name_trgm ON public.cities USING gin (name public.gin_trgm_ops);


--
-- Name: curated_artists curated_artists_curation_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: curator_app
--

ALTER TABLE ONLY public.curated_artists
    ADD CONSTRAINT curated_artists_curation_request_id_fkey FOREIGN KEY (curation_request_id) REFERENCES public.curation_requests(id);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

--
-- PostgreSQL database dump complete
--
